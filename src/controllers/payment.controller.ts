import { Request, Response } from "express";
import { QuickBooksService } from "../services/quickbooks.service";

export class PaymentController {
    static async createPayment(req: Request, res: Response): Promise<void> {
        try {
            // 1. Validate required fields
            if (!req.body.CustomerRef?.value || !req.body.TotalAmt || !req.body.PaymentRefNum) {
                res.status(400).json({
                    error: 'CustomerRef.value, TotalAmt, and PaymentRefNum are required',
                    exampleRequest: {
                        CustomerRef: { value: "45" },
                        TotalAmt: 100.00,
                        PaymentRefNum: "PAY-12345",
                        PaymentMethodRef: { value: "1" }, // optional
                        DepositToAccountRef: { value: "35" }, // optional
                        UnappliedAmt: 0, // optional
                        PrivateNote: "Payment received via credit card" // optional
                    }
                });
                return;
            }

            // 2. Transform request to QuickBooks format
            const paymentData = {
                CustomerRef: {
                    value: req.body.CustomerRef.value,
                    name: req.body.CustomerRef.name || ''
                },
                TotalAmt: req.body.TotalAmt,
                PaymentRefNum: req.body.PaymentRefNum,
                TxnDate: req.body.TxnDate || new Date().toISOString().split('T')[0],
                PaymentMethodRef: req.body.PaymentMethodRef || { value: "1" }, // Default to cash
                DepositToAccountRef: req.body.DepositToAccountRef || null,
                UnappliedAmt: req.body.UnappliedAmt || 0,
                PrivateNote: req.body.PrivateNote || '',
                Line: req.body.Line || [] // Optional line items for specific invoice applications
            };

            // 3. If specific invoices are being paid, validate and format Line items
            if (req.body.Line && req.body.Line.length > 0) {
                paymentData.Line = req.body.Line.map((line: any) => ({
                    Amount: line.Amount,
                    LinkedTxn: [{
                        TxnId: line.LinkedTxn.TxnId,
                        TxnType: line.LinkedTxn.TxnType || 'Invoice'
                    }]
                }));
            }

            console.log("Creating payment in QuickBooks:", paymentData);

            // 4. Make API request
            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/payment?minorversion=65`,
                paymentData
            );

            // 5. Format response
            res.status(201).json({
                id: result.Payment.Id,
                paymentRefNum: result.Payment.PaymentRefNum,
                totalAmount: result.Payment.TotalAmt,
                unappliedAmount: result.Payment.UnappliedAmt,
                customer: {
                    id: result.Payment.CustomerRef.value,
                    name: result.Payment.CustomerRef.name
                },
                date: result.Payment.TxnDate,
                syncToken: result.Payment.SyncToken,
                paymentMethod: result.Payment.PaymentMethodRef?.value,
                depositToAccount: result.Payment.DepositToAccountRef?.value,
                appliedInvoices: result.Payment.Line?.map((line: any) => ({
                    amount: line.Amount,
                    invoiceId: line.LinkedTxn?.[0]?.TxnId
                })) || []
            });

        } catch (error: any) {
            console.error("Error creating payment:", {
                error: error.message,
                response: error.response?.data,
                stack: error.stack
            });

            const qboError = error.response?.data?.Fault?.Error?.[0] || {};
            res.status(error.response?.status || 500).json({
                error: qboError.Message || 'Payment creation failed',
                code: qboError.code,
                detail: qboError.Detail,
                ...(process.env.NODE_ENV === 'development' && {
                    debug: {
                        message: error.message,
                        stack: error.stack
                    }
                })
            });
        }
    }

    // static async getPayments(req: Request, res: Response): Promise<void> {
    //     try {
    //         // Get query parameters
    //         const { customerId, startDate, endDate, paymentMethod } = req.query;

    //         // Build base query
    //         let query = `SELECT 
    //             Id, PaymentRefNum, TotalAmt, UnappliedAmt,
    //             TxnDate, CustomerRef, PaymentMethodRef
    //             FROM Payment`;

    //         const conditions = [];
    //         if (customerId) conditions.push(`CustomerRef = '${customerId}'`);
    //         if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
    //         if (endDate) conditions.push(`TxnDate <= '${endDate}'`);
    //         if (paymentMethod) conditions.push(`PaymentMethodRef = '${paymentMethod}'`);

    //         if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
    //         query += ` ORDERBY TxnDate DESC MAXRESULTS 1000`;

    //         // Make API request
    //         const result = await QuickBooksService.apiRequest(
    //             'GET',
    //             `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=65`
    //         );

    //         // Transform response
    //         const payments = result.QueryResponse.Payment?.map((payment: any) => ({
    //             id: payment.Id,
    //             paymentRefNum: payment.PaymentRefNum,
    //             totalAmount: payment.TotalAmt,
    //             unappliedAmount: payment.UnappliedAmt,
    //             customerId: payment.CustomerRef?.value,
    //             paymentMethod: payment.PaymentMethodRef?.value,
    //             date: payment.TxnDate
    //         })) || [];

    //         res.json({
    //             count: payments.length,
    //             payments
    //         });

    //     } catch (error) {
    //         console.error("Failed to fetch payments:", error);
    //         res.status(500).json({
    //             error: 'Failed to fetch payments',
    //             details: error instanceof Error ? error.message : String(error),
    //             qboError: (error as any).response?.data
    //         });
    //     }
    // }

    // static async getPayments(req: Request, res: Response): Promise<void> {
    //     try {
    //         // Get query parameters
    //         const { customerId, startDate, endDate, paymentMethod } = req.query;

    //         // Build base query
    //         let query = `SELECT 
    //         Id, PaymentRefNum, TotalAmt, UnappliedAmt,
    //         TxnDate, CustomerRef, CustomerRef.name, 
    //         PaymentMethodRef, PaymentMethodRef.name
    //         FROM Payment`;

    //         const conditions = [];
    //         if (customerId) conditions.push(`CustomerRef = '${customerId}'`);
    //         if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
    //         if (endDate) conditions.push(`TxnDate <= '${endDate}'`);
    //         if (paymentMethod) conditions.push(`PaymentMethodRef = '${paymentMethod}'`);

    //         if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
    //         query += ` ORDERBY TxnDate DESC MAXRESULTS 1000`;

    //         // Make API request
    //         const result = await QuickBooksService.apiRequest(
    //             'GET',
    //             `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=65`
    //         );

    //         // Transform response to match frontend requirements
    //         const payments = result.QueryResponse.Payment?.map((payment: any) => ({
    //             id: payment.Id,
    //             paymentRefNum: payment.PaymentRefNum || undefined, // Only include if exists
    //             totalAmount: payment.TotalAmt,
    //             unappliedAmount: payment.UnappliedAmt,
    //             customer: {
    //                 id: payment.CustomerRef?.value,
    //                 name: payment.CustomerRef?.name || 'Unknown Customer'
    //             },
    //             paymentMethod: {
    //                 id: payment.PaymentMethodRef?.value || '1', // Default to cash if not specified
    //                 name: payment.PaymentMethodRef?.name || 'Cash'
    //             },
    //             date: payment.TxnDate,
    //             syncToken: payment.SyncToken || '0' // Default syncToken if not present
    //         })) || [];

    //         res.json({
    //             count: payments.length,
    //             payments
    //         });

    //     } catch (error) {
    //         console.error("Failed to fetch payments:", error);
    //         res.status(500).json({
    //             error: 'Failed to fetch payments',
    //             details: error instanceof Error ? error.message : String(error),
    //             qboError: (error as any).response?.data
    //         });
    //     }
    // }


   static async getPayments(req: Request, res: Response): Promise<void> {
    try {
        // Get query parameters
        const { customerId, startDate, endDate, paymentMethod } = req.query;

        // Build base query - simplified to only essential fields
        let query = `SELECT Id, PaymentRefNum, TotalAmt, UnappliedAmt, TxnDate, CustomerRef, PaymentMethodRef, SyncToken FROM Payment`;

        const conditions = [];
        if (customerId) conditions.push(`CustomerRef = '${customerId}'`);
        if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
        if (endDate) conditions.push(`TxnDate <= '${endDate}'`);
        if (paymentMethod) conditions.push(`PaymentMethodRef = '${paymentMethod}'`);

        if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
        query += ` ORDERBY TxnDate DESC MAXRESULTS 100`;

        // Make API request
        const result = await QuickBooksService.apiRequest(
            'GET',
            `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=65`
        );

        // Transform response with safe property access
        const payments = result.QueryResponse.Payment?.map((payment: any) => {
            // Get customer ID safely
            const customerRef = payment.CustomerRef || {};
            const paymentMethodRef = payment.PaymentMethodRef || {};

            return {
                id: payment.Id,
                paymentRefNum: payment.PaymentRefNum || undefined,
                totalAmount: payment.TotalAmt || 0,
                unappliedAmount: payment.UnappliedAmt || 0,
                customer: {
                    id: customerRef.value || '0',
                    name: customerRef.name || 'Unknown Customer'
                },
                paymentMethod: {
                    id: paymentMethodRef.value || '1',
                    name: paymentMethodRef.name || 'Cash'
                },
                date: payment.TxnDate || new Date().toISOString().split('T')[0],
                syncToken: payment.SyncToken || '0'
            };
        }) || [];

        res.json({
            count: payments.length,
            payments
        });

    } catch (error) {
        console.error("Failed to fetch payments:", {
            error: error.message,
            stack: error.stack,
            response: error.response?.data
        });

        res.status(500).json({
            error: 'Failed to fetch payments',
            details: error.message,
            qboError: error.response?.data || { message: 'No additional details available' }
        });
    }
}
    // Helper method to get customer names
    private static async getCustomerNames(customerIds: string[]): Promise<Record<string, string>> {
        if (customerIds.length === 0) return {};

        try {
            const query = `SELECT Id, DisplayName FROM Customer WHERE Id IN ('${customerIds.join("','")}')`;
            const result = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=65`
            );

            return result.QueryResponse.Customer?.reduce((acc: Record<string, string>, customer: any) => {
                acc[customer.Id] = customer.DisplayName;
                return acc;
            }, {}) || {};
        } catch (error) {
            console.error("Failed to fetch customer names:", error);
            return {};
        }
    }

    // Helper method to get payment method names
    private static async getPaymentMethodNames(paymentMethodIds: string[]): Promise<Record<string, string>> {
        if (paymentMethodIds.length === 0) return {};

        try {
            const query = `SELECT Id, Name FROM PaymentMethod WHERE Id IN ('${paymentMethodIds.join("','")}')`;
            const result = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=65`
            );

            return result.QueryResponse.PaymentMethod?.reduce((acc: Record<string, string>, method: any) => {
                acc[method.Id] = method.Name;
                return acc;
            }, {}) || {};
        } catch (error) {
            console.error("Failed to fetch payment method names:", error);
            return {};
        }
    }

    static async getPaymentById(req: Request, res: Response): Promise<void> {
        try {
            const paymentId = req.params.id;
            if (!paymentId) {
                res.status(400).json({ error: 'Payment ID is required' });
                return;
            }

            // Make API request
            const result = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}?minorversion=65`
            );

            if (!result.Payment) {
                res.status(404).json({ error: 'Payment not found' });
                return;
            }

            const payment = result.Payment;

            // Format response
            const responseData = {
                id: payment.Id,
                paymentRefNum: payment.PaymentRefNum,
                totalAmount: payment.TotalAmt,
                unappliedAmount: payment.UnappliedAmt,
                customer: {
                    id: payment.CustomerRef.value,
                    name: payment.CustomerRef.name
                },
                paymentMethod: {
                    id: payment.PaymentMethodRef?.value,
                    name: payment.PaymentMethodRef?.name
                },
                depositToAccount: payment.DepositToAccountRef ? {
                    id: payment.DepositToAccountRef.value,
                    name: payment.DepositToAccountRef.name
                } : null,
                date: payment.TxnDate,
                privateNote: payment.PrivateNote || '',
                appliedInvoices: payment.Line?.map((line: any) => ({
                    amount: line.Amount,
                    invoiceId: line.LinkedTxn?.[0]?.TxnId,
                    invoiceDocNumber: line.LinkedTxn?.[0]?.TxnDocNum
                })) || [],
                syncToken: payment.SyncToken
            };

            res.json(responseData);

        } catch (error) {
            console.error(`Failed to fetch payment ${req.params.id}:`, error);

            const errorResponse: any = {
                message: 'Failed to fetch payment details',
                error: error instanceof Error ? error.message : 'Unknown error'
            };

            if ((error as any).response?.data) {
                errorResponse.qboError = (error as any).response.data;
            }

            res.status(500).json(errorResponse);
        }
    }

    static async updatePayment(req: Request, res: Response): Promise<void> {
        try {
            // 1. Validate payment ID
            const paymentId = req.params.id;
            if (!paymentId || !/^\d+$/.test(paymentId)) {
                res.status(400).json({ error: 'Valid numeric Payment ID is required' });
                return;
            }

            // 2. Log the incoming request
            console.log('Update payment request:', {
                id: paymentId,
                body: req.body,
                headers: req.headers
            });

            // 3. Get current payment state for SyncToken
            let currentPayment;
            try {
                currentPayment = await QuickBooksService.apiRequest(
                    'GET',
                    `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}?minorversion=65`
                );

                if (!currentPayment || !currentPayment.Payment) {
                    res.status(404).json({ error: 'Payment not found in QuickBooks' });
                    return;
                }
            } catch (error) {
                if (error.response?.status === 404) {
                    res.status(404).json({ error: 'Payment not found in QuickBooks' });
                    return;
                }
                throw error;
            }

            // 4. Validate request payload
            if (!req.body || typeof req.body !== 'object') {
                res.status(400).json({ error: 'Request body must be a valid JSON object' });
                return;
            }

            // 5. Prepare update payload
            const paymentData = {
                Id: paymentId,
                SyncToken: currentPayment.Payment.SyncToken,
                sparse: true,
                CustomerRef: {
                    value: req.body.CustomerRef?.value || currentPayment.Payment.CustomerRef.value,
                    name: req.body.CustomerRef?.name || currentPayment.Payment.CustomerRef.name
                },
                TotalAmt: req.body.TotalAmt || currentPayment.Payment.TotalAmt,
                PaymentRefNum: req.body.PaymentRefNum || currentPayment.Payment.PaymentRefNum,
                TxnDate: req.body.TxnDate || currentPayment.Payment.TxnDate,
                PaymentMethodRef: req.body.PaymentMethodRef || currentPayment.Payment.PaymentMethodRef,
                DepositToAccountRef: req.body.DepositToAccountRef || currentPayment.Payment.DepositToAccountRef,
                UnappliedAmt: req.body.UnappliedAmt !== undefined ? req.body.UnappliedAmt : currentPayment.Payment.UnappliedAmt,
                PrivateNote: req.body.PrivateNote || currentPayment.Payment.PrivateNote || '',
                Line: req.body.Line || currentPayment.Payment.Line || []
            };

            console.log('Prepared payment update payload:', JSON.stringify(paymentData, null, 2));

            // 6. Send update request
            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/payment?minorversion=65&operation=update`,
                paymentData,
                'json'
            );

            // 7. Validate response
            if (!result?.Payment?.Id) {
                throw new Error('Invalid response from QuickBooks API');
            }

            // 8. Return success response
            res.status(200).json({
                success: true,
                id: result.Payment.Id,
                paymentRefNum: result.Payment.PaymentRefNum,
                totalAmount: result.Payment.TotalAmt,
                unappliedAmount: result.Payment.UnappliedAmt,
                customer: {
                    id: result.Payment.CustomerRef.value,
                    name: result.Payment.CustomerRef.name
                },
                paymentMethod: result.Payment.PaymentMethodRef?.value,
                syncToken: result.Payment.SyncToken,
                date: result.Payment.TxnDate
            });

        } catch (error) {
            console.error('Payment update failed:', {
                timestamp: new Date().toISOString(),
                error: error.message,
                stack: error.stack,
                response: {
                    status: error.response?.status,
                    data: error.response?.data,
                    headers: error.response?.headers
                },
                request: {
                    url: error.config?.url,
                    method: error.config?.method,
                    data: error.config?.data
                }
            });

            const qboError = error.response?.data?.Fault?.Error?.[0] || {};
            const statusCode = error.response?.status || 500;

            res.status(statusCode).json({
                error: qboError.Message || 'Payment update failed',
                code: qboError.code,
                detail: qboError.Detail,
                ...(process.env.NODE_ENV === 'development' && {
                    debug: {
                        message: error.message,
                        stack: error.stack,
                        qboErrorDetails: error.response?.data?.Fault
                    }
                })
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

            // 1. Get current payment to obtain SyncToken
            const currentPayment = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}?minorversion=65`
            );

            if (!currentPayment?.Payment) {
                res.status(404).json({ error: 'Payment not found' });
                return;
            }

            // 2. Prepare delete payload
            const deletePayload = {
                Id: paymentId,
                SyncToken: currentPayment.Payment.SyncToken,
                sparse: true
            };

            // 3. Send delete request (operation=delete)
            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/payment?minorversion=65&operation=delete`,
                deletePayload,
                'json'
            );

            // 4. Return success response
            res.json({
                success: true,
                message: 'Payment deleted successfully',
                paymentId: result.Payment?.Id,
                status: result.Payment?.status
            });

        } catch (error) {
            console.error('Failed to delete payment:', error);

            const qboError = error.response?.data?.Fault?.Error?.[0] || {};
            res.status(error.response?.status || 500).json({
                error: qboError.Message || 'Payment deletion failed',
                code: qboError.code,
                detail: qboError.Detail,
                ...(process.env.NODE_ENV === 'development' && {
                    debug: {
                        message: error.message,
                        stack: error.stack
                    }
                })
            });
        }
    }

    static async applyPaymentToInvoice(req: Request, res: Response): Promise<void> {
        try {
            const { paymentId, invoiceId, amount } = req.body;

            // 1. Validate inputs
            if (!paymentId || !invoiceId || amount === undefined) {
                res.status(400).json({
                    error: 'paymentId, invoiceId, and amount are required',
                    exampleRequest: {
                        paymentId: "123",
                        invoiceId: "456",
                        amount: 100.00
                    }
                });
                return;
            }

            // 2. Get current payment state
            const currentPayment = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/payment/${paymentId}?minorversion=65`
            );

            if (!currentPayment?.Payment) {
                res.status(404).json({ error: 'Payment not found' });
                return;
            }

            // 3. Get invoice to validate existence
            await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/invoice/${invoiceId}?minorversion=65`
            );

            // 4. Prepare update payload with new line item
            const paymentData = {
                Id: paymentId,
                SyncToken: currentPayment.Payment.SyncToken,
                sparse: true,
                CustomerRef: currentPayment.Payment.CustomerRef,
                TotalAmt: currentPayment.Payment.TotalAmt,
                PaymentRefNum: currentPayment.Payment.PaymentRefNum,
                TxnDate: currentPayment.Payment.TxnDate,
                Line: [
                    ...(currentPayment.Payment.Line || []),
                    {
                        Amount: amount,
                        LinkedTxn: [{
                            TxnId: invoiceId,
                            TxnType: 'Invoice'
                        }]
                    }
                ]
            };

            // 5. Send update request
            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/payment?minorversion=65&operation=update`,
                paymentData,
                'json'
            );

            // 6. Return success response
            res.json({
                success: true,
                paymentId: result.Payment.Id,
                invoiceId,
                amountApplied: amount,
                newUnappliedAmount: result.Payment.UnappliedAmt,
                syncToken: result.Payment.SyncToken
            });

        } catch (error) {
            console.error('Failed to apply payment to invoice:', error);

            const qboError = error.response?.data?.Fault?.Error?.[0] || {};
            res.status(error.response?.status || 500).json({
                error: qboError.Message || 'Failed to apply payment to invoice',
                code: qboError.code,
                detail: qboError.Detail,
                ...(process.env.NODE_ENV === 'development' && {
                    debug: {
                        message: error.message,
                        stack: error.stack
                    }
                })
            });
        }
    }
}