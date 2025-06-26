import { Request, Response } from "express";
import { QuickBooksService } from "../services/quickbooks.service";

export class PaymentController {
    static async createPayment(req: Request, res: Response): Promise<void> {
        try {
            console.log("Received payment request body:", req.body);

            // Validate required fields
            if (!req.body.CustomerRef?.value || !req.body.TotalAmt || !req.body.PaymentMethodRef?.value) {
                res.status(400).json({ 
                    error: 'CustomerRef.value, TotalAmt, and PaymentMethodRef.value are required',
                    exampleRequest: {
                        CustomerRef: { value: "123" },
                        TotalAmt: 100.00,
                        PaymentMethodRef: { value: "1" }, // 1=Check, 2=Cash, etc.
                        PaymentRefNum: "CHECK123",
                        UnappliedAmt: 0,
                        PrivateNote: "Payment received",
                        Line: [
                            {
                                Amount: 100.00,
                                LinkedTxn: [
                                    {
                                        TxnId: "145", // Invoice ID
                                        TxnType: "Invoice"
                                    }
                                ]
                            }
                        ]
                    }
                });
                return;
            }

            // Transform line items if provided
            const lineItems = req.body.Line?.map((item: any) => {
                if (!item.Amount || !item.LinkedTxn?.[0]?.TxnId) {
                    throw new Error('Each payment line requires Amount and LinkedTxn with TxnId');
                }

                return {
                    Amount: item.Amount,
                    LinkedTxn: item.LinkedTxn.map((txn: any) => ({
                        TxnId: txn.TxnId,
                        TxnType: txn.TxnType || "Invoice"
                    })),
                    LineEx: item.LineEx || undefined
                };
            }) || [];

            const paymentData = {
                CustomerRef: req.body.CustomerRef,
                TotalAmt: req.body.TotalAmt,
                PaymentMethodRef: req.body.PaymentMethodRef,
                PaymentRefNum: req.body.PaymentRefNum || undefined,
                UnappliedAmt: req.body.UnappliedAmt || 0,
                PrivateNote: req.body.PrivateNote || undefined,
                TxnDate: req.body.TxnDate || new Date().toISOString().split('T')[0],
                Line: lineItems.length ? lineItems : undefined,
                DepositToAccountRef: req.body.DepositToAccountRef || undefined,
                CurrencyRef: req.body.CurrencyRef || undefined,
                ExchangeRate: req.body.ExchangeRate || undefined,
                // Include other optional fields as needed
            };

            console.log("Constructed payment data:", paymentData);

            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/payment?minorversion=65`,
                paymentData
            );

            res.status(201).json({
                id: result.Payment.Id,
                paymentRefNum: result.Payment.PaymentRefNum,
                totalAmount: result.Payment.TotalAmt,
                unappliedAmount: result.Payment.UnappliedAmt,
                customerId: result.Payment.CustomerRef.value,
                qboId: result.Payment.Id
            });
        } catch (error) {
            console.error("Error creating payment:", error);

            if (error instanceof Error) {
                const errorData = {
                    message: error.message,
                    stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
                    responseData: (error as any).response?.data
                };
                res.status(500).json(errorData);
            } else {
                res.status(500).json({ error: 'Unknown error occurred' });
            }
        }
    }

    static async getPayments(req: Request, res: Response): Promise<void> {
        try {
            // Get customerId from query params
            const customerId = req.query.customerId as string | undefined;
            const startDate = req.query.startDate as string | undefined;
            const endDate = req.query.endDate as string | undefined;

            // Build base query
            let query = `SELECT 
                Id, PaymentRefNum, CustomerRef, TotalAmt, UnappliedAmt,
                TxnDate, PaymentMethodRef, PrivateNote
                FROM Payment`;

            const conditions = [];
            if (customerId) conditions.push(`CustomerRef = '${customerId}'`);
            if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
            if (endDate) conditions.push(`TxnDate <= '${endDate}'`);

            if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
            query += ` ORDERBY TxnDate DESC MAXRESULTS 1000`;

            // Make API request
            const result = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=65`
            );

            // Transform response
            const payments = result.QueryResponse.Payment?.map((payment: any) => ({
                id: payment.Id,
                paymentRefNum: payment.PaymentRefNum,
                customerId: payment.CustomerRef?.value,
                totalAmount: payment.TotalAmt,
                unappliedAmount: payment.UnappliedAmt,
                paymentMethod: payment.PaymentMethodRef?.value,
                date: payment.TxnDate,
                privateNote: payment.PrivateNote
            })) || [];

            res.json({
                count: payments.length,
                payments
            });

        } catch (error) {
            res.status(500).json({
                error: 'Failed to fetch payments',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    static async getPaymentDetails(req: Request, res: Response): Promise<void> {
        try {
            const paymentId = req.params.id;

            if (!paymentId) {
                res.status(400).json({ error: 'Payment ID is required' });
                return;
            }

            const result = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}?minorversion=65`
            );

            // Return full payment object with all details
            res.json({
                payment: {
                    ...result.Payment,
                    // Add any additional transformations if needed
                }
            });

        } catch (error) {
            res.status(500).json({
                error: 'Failed to fetch payment details',
                details: error instanceof Error ? error.message : String(error),
                qboError: (error as any).response?.data
            });
        }
    }

    static async deletePayment(req: Request, res: Response): Promise<void> {
        try {
            const paymentId = req.params.id;

            if (!paymentId) {
                res.status(400).json({ error: 'Payment ID is required' });
                return;
            }

            // First get the payment to check sync token
            const payment = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}?minorversion=65`
            );

            // Then delete with the correct sync token
            const result = await QuickBooksService.apiRequest(
                'DELETE',
                `/v3/company/${process.env.QB_REALM_ID}/payment?operation=delete&minorversion=65`,
                {
                    Id: paymentId,
                    SyncToken: payment.Payment.SyncToken
                }
            );

            res.json({
                success: true,
                paymentId,
                status: result.Payment.status,
                deletionTime: new Date().toISOString()
            });

        } catch (error) {
            res.status(500).json({
                error: 'Failed to delete payment',
                details: error instanceof Error ? error.message : String(error),
                qboError: (error as any).response?.data
            });
        }
    }

    static async voidPayment(req: Request, res: Response): Promise<void> {
        try {
            const paymentId = req.params.id;

            if (!paymentId) {
                res.status(400).json({ error: 'Payment ID is required' });
                return;
            }

            // First get the payment to check sync token
            const payment = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}?minorversion=65`
            );

            // Then void with the correct sync token
            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/payment?operation=void&minorversion=65`,
                {
                    Id: paymentId,
                    SyncToken: payment.Payment.SyncToken
                }
            );

            res.json({
                success: true,
                paymentId,
                status: result.Payment.status,
                voidedTime: new Date().toISOString()
            });

        } catch (error) {
            res.status(500).json({
                error: 'Failed to void payment',
                details: error instanceof Error ? error.message : String(error),
                qboError: (error as any).response?.data
            });
        }
    }

    static async getPaymentPDF(req: Request, res: Response): Promise<void> {
        let paymentId: string | undefined;
        try {
            paymentId = req.params.id;

            if (!paymentId) {
                res.status(400).json({ error: 'Payment ID is required' });
                return;
            }

            const pdfData = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}/pdf`,
                null,
                'arraybuffer'
            );

            // Set PDF headers
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=payment_${paymentId}.pdf`);

            // Send the PDF buffer
            res.send(Buffer.from(pdfData));

        } catch (error) {
            console.error(`Failed to fetch PDF for payment ${paymentId}:`, error);

            const errorResponse = {
                message: 'Failed to generate PDF',
                error: error instanceof Error ? error.message : 'Unknown error',
                qboError: (error as any).response?.data
            };

            res.status(500).json(errorResponse);
        }
    }

    static async sendPaymentReceipt(req: Request, res: Response): Promise<void> {
        try {
            const { paymentId, email } = req.body;

            if (!paymentId) {
                res.status(400).json({
                    error: 'paymentId is required',
                    exampleRequest: {
                        paymentId: "145",
                        email: "customer@example.com" // optional
                    }
                });
                return;
            }

            // Verify Payment Exists
            const payment = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}?minorversion=75`
            );

            // Prepare the Request
            const endpoint = email
                ? `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}/send?sendTo=${encodeURIComponent(email)}&minorversion=75`
                : `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}/send?minorversion=75`;

            // Make the API Call
            const result = await QuickBooksService.apiRequest(
                'POST',
                endpoint,
                null, // No body needed
                'json'
            );

            // Return Success Response
            res.json({
                success: true,
                paymentId,
                emailUsed: email || payment.Payment.PrimaryEmailAddr?.Address,
                status: result.Payment.EmailStatus,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const errorInfo = {
                error: 'Failed to send payment receipt',
                quickbooksErrorCode: (error as any).response?.data?.Fault?.Error?.[0]?.code,
                details: (error as any).response?.data?.Fault?.Error?.[0]?.Message,
                technicalDetails: (error as any).response?.data?.Fault?.Error?.[0]?.Detail,
                troubleshooting: [
                    '1. Verify the payment exists and is not voided',
                    '2. Check email settings in QuickBooks',
                    '3. Ensure your OAuth token has both "com.intuit.quickbooks.accounting" and "email" scopes'
                ],
                requestDebug: {
                    paymentId: req.body.paymentId,
                    emailAttempted: req.body.email,
                    endpointUsed: (error as any).config?.url,
                    realmId: process.env.QB_REALM_ID
                }
            };

            res.status((error as any).response?.status || 500).json(errorInfo);
        }
    }

    static async updatePayment(req: Request, res: Response): Promise<void> {
        try {
            const paymentId = req.params.id;
            const updateData = req.body;

            if (!paymentId) {
                res.status(400).json({ error: 'Payment ID is required' });
                return;
            }

            // First get the current payment to ensure we have the latest SyncToken
            const currentPayment = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}?minorversion=65`
            );

            // Prepare update payload
            const updatePayload = {
                ...updateData,
                Id: paymentId,
                SyncToken: currentPayment.Payment.SyncToken,
                sparse: true // Only update the fields we're sending
            };

            // Make the update request
            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/payment?minorversion=65`,
                updatePayload
            );

            res.json({
                success: true,
                paymentId,
                updatedFields: Object.keys(updateData),
                newSyncToken: result.Payment.SyncToken,
                updateTime: new Date().toISOString()
            });

        } catch (error) {
            res.status(500).json({
                error: 'Failed to update payment',
                details: error instanceof Error ? error.message : String(error),
                qboError: (error as any).response?.data
            });
        }
    }
}