import { Request, Response } from "express";
import { QuickBooksService } from "../services/quickbooks.service";

export class InvoiceController {
    static async createInvoice(req: Request, res: Response): Promise<void> {
        try {
            console.log("Received request body:", req.body);

            // Validate required fields
            if (!req.body.CustomerRef?.value || !req.body.Line) {
                res.status(400).json({ error: 'CustomerRef.value and Line items are required' });
            }

            // Transform line items with proper amount calculation
            const lineItems = req.body.Line.map((item: any) => {
                if (!item.SalesItemLineDetail?.ItemRef?.value || !item.SalesItemLineDetail?.UnitPrice || !item.SalesItemLineDetail?.Qty) {
                    throw new Error('Each line item requires ItemRef.value, UnitPrice, and Qty');
                }

                const amount = item.SalesItemLineDetail.UnitPrice * item.SalesItemLineDetail.Qty;

                return {
                    DetailType: 'SalesItemLineDetail',
                    Amount: amount,
                    SalesItemLineDetail: {
                        ItemRef: { value: item.SalesItemLineDetail.ItemRef.value },
                        UnitPrice: item.SalesItemLineDetail.UnitPrice,
                        Qty: item.SalesItemLineDetail.Qty
                    },
                    Description: item.Description || ''
                };
            });

            const invoiceData = {
                Line: lineItems,
                CustomerRef: req.body.CustomerRef, // Use as-is (already has value property)
                TxnDate: req.body.TxnDate || new Date().toISOString().split('T')[0],
                DueDate: req.body.DueDate,
                DocNumber: req.body.DocNumber,
                CustomerMemo: req.body.CustomerMemo || undefined
                // Include other optional fields as needed
            };

            console.log("Constructed invoice data:", invoiceData);

            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/invoice?minorversion=65`,
                invoiceData
            );

            res.status(201).json({
                id: result.Invoice.Id,
                docNumber: result.Invoice.DocNumber,
                totalAmount: result.Invoice.TotalAmt,
                balance: result.Invoice.Balance,
                qboId: result.Invoice.Id
            });
        } catch (error) {
            console.error("Error creating invoice:", error);

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


    static async getInvoices(req: Request, res: Response): Promise<void> {
        try {
            // Get customerId from query params
            const customerId = req.query.customerId as string | undefined;

            // Build base query
            let query = `SELECT 
            Id, DocNumber, CustomerRef, TotalAmt, Balance,
            DueDate, TxnDate, EmailStatus
            FROM Invoice`;

            // Add customer filter if provided
            if (customerId) {
                query += ` WHERE CustomerRef = '${customerId}'`;
            }

            // Add sorting and limits
            query += ` ORDERBY TxnDate DESC MAXRESULTS 1000`;

            // Make API request
            const result = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=65`
            );

            // Transform response
            const invoices = result.QueryResponse.Invoice?.map((inv: any) => ({
                id: inv.Id,
                docNumber: inv.DocNumber,
                customerId: inv.CustomerRef?.value,
                totalAmount: inv.TotalAmt,
                balance: inv.Balance,
                status: inv.Balance === 0 ? 'PAID' : 'OPEN',
                dueDate: inv.DueDate,
                date: inv.TxnDate
            })) || [];

            res.json({
                count: invoices.length,
                invoices
            });

        } catch (error) {
            res.status(500).json({
                error: 'Failed to fetch invoices',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    static async getInvoicesDetailed(req: Request, res: Response): Promise<void> {
        try {
            const { customerId, startDate, endDate } = req.query;

            // Build query with all needed fields
            let query = `SELECT * FROM Invoice`;
            const conditions = [];

            if (customerId) conditions.push(`CustomerRef = '${customerId}'`);
            if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
            if (endDate) conditions.push(`TxnDate <= '${endDate}'`);

            if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
            query += ` ORDERBY Metadata.LastUpdatedTime DESC MAXRESULTS 100`;

            const result = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=65`
            );

            // Return full invoice objects with all details
            const invoices = result.QueryResponse.Invoice || [];

            res.json({
                count: invoices.length,
                invoices: invoices.map((inv: { Balance: number; EmailStatus: string; }) => ({
                    ...inv,
                    // Add human-readable status if needed
                    HumanStatus: inv.Balance === 0 ? 'PAID' :
                        inv.EmailStatus === 'EmailSent' ? 'SENT' : 'DRAFT'
                }))
            });

        } catch (error) {
            res.status(500).json({
                error: 'Failed to fetch invoices',
                details: error instanceof Error ? error.message : String(error),
                qboError: (error as any).response?.data
            });
        }
    }


    static async getInvoicePDF(req: Request, res: Response): Promise<void> {
        try {
            const invoiceId = req.params.id;

            if (!invoiceId) {
                res.status(400).json({ error: 'Invoice ID is required' });
            }

            const pdfData = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/invoice/${invoiceId}/pdf`,
                null,
                'arraybuffer' // This is crucial for PDF responses
            );

            // Set PDF headers
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=invoice_${invoiceId}.pdf`);

            // Send the PDF buffer
            res.send(Buffer.from(pdfData));

        } catch (error) {
            console.error(`Failed to fetch PDF for invoice ${req.params.id}:`, error);

            const errorResponse = {
                message: 'Failed to generate PDF',
                error: error instanceof Error ? error.message : 'Unknown error',
                qboError: (error as any).response?.data
            };

            res.status(500).json(errorResponse);
        }
    }

    static async sendInvoice(req: Request, res: Response): Promise<void> {
        try {
            const { invoiceId, email } = req.body;

            // 1. Validate Inputs
            if (!invoiceId) {
                res.status(400).json({
                    error: 'invoiceId is required',
                    exampleRequest: {
                        invoiceId: "145",
                        email: "customer@example.com" // optional
                    }
                });
            }

            // 2. Verify Invoice Exists
            const invoice = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/invoice/${invoiceId}?minorversion=75`
            );

            console.log(invoice, "invoiceDetail")

            // 3. Prepare the Request
            const endpoint = email
                ? `/v3/company/${process.env.QB_REALM_ID}/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(email)}&minorversion=75`
                : `/v3/company/${process.env.QB_REALM_ID}/invoice/${invoiceId}/send?minorversion=75`;

            console.log(endpoint, "endPoint")

            // 4. Make the API Call
            const result = await QuickBooksService.apiRequest(
                'POST',
                endpoint,
                null, // No body needed
                'json'
            );

            // 5. Return Success Response
            res.json({
                success: true,
                invoiceId,
                emailUsed: email || invoice.Invoice.BillEmail?.Address,
                status: result.Invoice.EmailStatus,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            // Enhanced error diagnostics
            const errorInfo = {
                error: 'Failed to send invoice',
                quickbooksErrorCode: error.response?.data?.Fault?.Error?.[0]?.code,
                details: error.response?.data?.Fault?.Error?.[0]?.Message,
                technicalDetails: error.response?.data?.Fault?.Error?.[0]?.Detail,
                troubleshooting: [
                    '1. Verify the invoice exists and is not voided',
                    '2. Check email settings in QuickBooks (Gear Icon → Account Settings → Sales → Messages)',
                    '3. Ensure your OAuth token has both "com.intuit.quickbooks.accounting" and "email" scopes'
                ],
                requestDebug: {
                    invoiceId: req.body.invoiceId,
                    emailAttempted: req.body.email,
                    endpointUsed: error.config?.url,
                    realmId: process.env.QB_REALM_ID
                }
            };

            res.status(error.response?.status || 500).json(errorInfo);
        }
    }
}
