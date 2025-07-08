import { Request, Response } from "express";
import { QuickBooksService } from "../services/quickbooks.service";

export class InvoiceController {


    // Helper method to calculate due date (synchronous)
    private static calculateDueDate(days: number): string {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
    }

    static async createInvoice(req: Request, res: Response): Promise<void> {
        try {
            // Validate required fields
            if (!req.body.CustomerRef?.value || !req.body.Line || req.body.Line.length === 0) {
                res.status(400).json({ error: 'CustomerRef.value and at least one Line item are required' });
                return;
            }

            // Transform request to QuickBooks format
            const invoiceData = {
                Line: req.body.Line.map((item: any) => {
                    const lineItem: any = {
                        DetailType: 'SalesItemLineDetail',
                        Amount: item.Amount,
                    };

                    // Add description if provided
                    if (item.Description) {
                        lineItem.Description = item.Description;
                    }

                    // Handle SalesItemLineDetail
                    if (item.SalesItemLineDetail) {
                        lineItem.SalesItemLineDetail = {
                            ItemRef: {
                                value: item.SalesItemLineDetail.ItemRef.value
                            }
                        };

                        // Add quantity if provided, default to 1
                        lineItem.SalesItemLineDetail.Qty = item.SalesItemLineDetail.Qty ?? 1;

                        // Calculate UnitPrice if not provided
                        lineItem.SalesItemLineDetail.UnitPrice =
                            item.SalesItemLineDetail.UnitPrice ??
                            item.Amount / lineItem.SalesItemLineDetail.Qty;
                    }

                    return lineItem;
                }),
                CustomerRef: {
                    value: req.body.CustomerRef.value
                },
                TxnDate: req.body.TxnDate || new Date().toISOString().split('T')[0],
                DueDate: req.body.DueDate || InvoiceController.calculateDueDate(30),
                CustomerMemo: {
                    value: req.body.CustomerMemo || ''
                }
            };

            console.log("Sending to QuickBooks:", invoiceData);

            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/invoice?minorversion=65`,
                invoiceData
            );

            // Filter out SubTotalLineDetail from response
            const lineItems = result.Invoice.Line
                .filter((line: any) => line.DetailType === 'SalesItemLineDetail')
                .map((line: any) => ({
                    amount: line.Amount,
                    itemId: line.SalesItemLineDetail?.ItemRef?.value
                }));

            res.status(201).json({
                id: result.Invoice.Id,
                docNumber: result.Invoice.DocNumber,
                totalAmount: result.Invoice.TotalAmt,
                balance: result.Invoice.Balance,
                status: result.Invoice.status || 'OPEN',
                lineItems,
                pdfUrl: `/api/invoices/${result.Invoice.Id}/pdf`,
                date: result.Invoice.TxnDate,
                dueDate: result.Invoice.DueDate
            });

        } catch (error: any) {
            console.error("Error creating invoice:", error);

            // Enhanced error logging
            if (error.response) {
                console.error("QuickBooks API response error:", {
                    status: error.response.status,
                    data: error.response.data
                });
            }

            res.status(500).json({
                error: error.message,
                details: error.response?.data || 'No additional details'
            });
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
            return;
        }

        // Specify PDF-specific headers
        const pdfHeaders:any = {
            'Accept': 'application/pdf',
            'Content-Type': 'application/pdf'
        };

        const pdfData = await QuickBooksService.apiRequest(
            'GET',
            `/v3/company/${process.env.QB_REALM_ID}/invoice/${invoiceId}/pdf?minorversion=65`,
            null,
            'arraybuffer',
            pdfHeaders // Pass the custom headers
        );

        // Verify PDF data
        if (!pdfData || !Buffer.isBuffer(pdfData)) {
            throw new Error('Invalid PDF data received from QuickBooks');
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=invoice_${invoiceId}.pdf`);
        res.send(pdfData);

    } catch (error) {
        console.error(`PDF generation failed:`, error);
        
        let qboError = 'No additional details';
        if ((error as any).response?.data) {
            try {
                qboError = Buffer.isBuffer((error as any).response.data)
                    ? (error as any).response.data.toString('utf8')
                    : JSON.stringify((error as any).response.data);
            } catch (e) {
                qboError = 'Unable to parse error details';
            }
        }

        res.status(500).json({
            message: 'Failed to generate PDF',
            error: error instanceof Error ? error.message : 'Unknown error',
            qboError: qboError
        });
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


    static async getInvoiceById(req: Request, res: Response): Promise<void> {
        try {
            const invoiceId = req.params.id;

            if (!invoiceId) {
                res.status(400).json({ error: 'Invoice ID is required' });
                return;
            }

            // Make API request to get the invoice details
            const result = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/invoice/${invoiceId}?minorversion=65`
            );

            if (!result.Invoice) {
                res.status(404).json({ error: 'Invoice not found' });
                return;
            }

            const invoice = result.Invoice;

            // Filter out SubTotalLineDetail and other non-product lines
            const lineItems = invoice.Line
                .filter((item: any) => {
                    // Only include SalesItemLineDetail with valid ItemRef
                    return item.DetailType === 'SalesItemLineDetail' &&
                        item.SalesItemLineDetail?.ItemRef?.value;
                })
                .map((item: any) => ({
                    description: item.Description || '',
                    amount: item.Amount,
                    quantity: item.SalesItemLineDetail.Qty || 1,
                    unitPrice: item.SalesItemLineDetail.UnitPrice || item.Amount,
                    itemId: item.SalesItemLineDetail.ItemRef.value
                }));

            // Transform the response
            const responseData = {
                id: invoice.Id,
                docNumber: invoice.DocNumber,
                customer: {
                    id: invoice.CustomerRef.value,
                    name: invoice.CustomerRef.name
                },
                status: invoice.Balance === 0 ? 'PAID' : 'OPEN',
                emailStatus: invoice.EmailStatus || 'NotSet',
                totalAmount: invoice.TotalAmt,
                balance: invoice.Balance,
                date: invoice.TxnDate,
                dueDate: invoice.DueDate,
                lineItems, // Now contains only actual product/service line items
                customerMemo: invoice.CustomerMemo?.value || '',
                billingAddress: {
                    Id: invoice.BillAddr?.Id,
                    Line1: invoice.BillAddr?.Line1 || '',
                    City: invoice.BillAddr?.City || '',
                    Country: invoice.BillAddr?.Country || '',
                    PostalCode: invoice.BillAddr?.PostalCode || ''
                },
                pdfUrl: `/api/invoices/${invoiceId}/pdf`
            };

            res.json(responseData);

        } catch (error) {
            console.error(`Failed to fetch invoice ${req.params.id}:`, error);

            const errorResponse: any = {
                message: 'Failed to fetch invoice details',
                error: error instanceof Error ? error.message : 'Unknown error'
            };

            if ((error as any).response?.data) {
                errorResponse.qboError = (error as any).response.data;
            }

            res.status(500).json(errorResponse);
        }
    }


    static async updateInvoice(req: Request, res: Response): Promise<void> {
        try {
            const invoiceId = req.params.id;
            if (!invoiceId) {
                res.status(400).json({ error: 'Invoice ID is required' });
                return;
            }

            // 1. Get current invoice state to obtain fresh SyncToken
            const currentInvoice = await QuickBooksService.apiRequest(
                'GET',
                `/v3/company/${process.env.QB_REALM_ID}/invoice/${invoiceId}?minorversion=65`
            );


            // 2. Validate required fields
            if (!req.body.CustomerRef?.value || !req.body.Line || req.body.Line.length === 0) {
                res.status(400).json({ error: 'CustomerRef.value and at least one Line item are required' });
                return;
            }

            // 3. Transform line items to match QuickBooks format
            const lineItems = req.body.Line.map((item: any) => {
                if (!item.SalesItemLineDetail?.ItemRef?.value ||
                    item.SalesItemLineDetail?.UnitPrice === undefined ||
                    item.SalesItemLineDetail?.Qty === undefined) {
                    throw new Error('Each line item requires ItemRef.value, UnitPrice, and Qty');
                }

                return {
                    DetailType: 'SalesItemLineDetail',
                    Amount: item.SalesItemLineDetail.UnitPrice * item.SalesItemLineDetail.Qty,
                    Description: item.Description || '',
                    SalesItemLineDetail: {
                        ItemRef: {
                            value: item.SalesItemLineDetail.ItemRef.value,
                            name: item.SalesItemLineDetail.ItemRef.name || ''
                        },
                        UnitPrice: item.SalesItemLineDetail.UnitPrice,
                        Qty: item.SalesItemLineDetail.Qty
                    }
                };
            });

            // 4. Prepare update payload with ALL required fields
            const invoiceData = {
                Id: invoiceId,
                SyncToken: currentInvoice.Invoice.SyncToken, // Use fresh SyncToken
                sparse: true,
                CustomerRef: {
                    value: req.body.CustomerRef.value,
                    name: req.body.CustomerRef.name || ''
                },
                TxnDate: req.body.TxnDate || currentInvoice.Invoice.TxnDate,
                DueDate: req.body.DueDate || currentInvoice.Invoice.DueDate,
                Line: lineItems,
                DocNumber: req.body.DocNumber || currentInvoice.Invoice.DocNumber,
                CustomerMemo: {
                    value: req.body.CustomerMemo || currentInvoice.Invoice.CustomerMemo?.value || ''
                },
                // Include other fields that might be required
                CurrencyRef: currentInvoice.Invoice.CurrencyRef,
                BillAddr: currentInvoice.Invoice.BillAddr,
                ShipFromAddr: currentInvoice.Invoice.ShipFromAddr
            };

            console.log('Sending update:', JSON.stringify(invoiceData, null, 2));

            // 5. Send update request
            const result = await QuickBooksService.apiRequest(
                'POST',
                `/v3/company/${process.env.QB_REALM_ID}/invoice?minorversion=65&operation=update`,
                invoiceData,
                'json'
            );

            // 6. Return formatted response
            res.status(200).json({
                id: result.Invoice.Id,
                docNumber: result.Invoice.DocNumber,
                totalAmount: result.Invoice.TotalAmt,
                balance: result.Invoice.Balance,
                qboId: result.Invoice.Id,
                customer: {
                    id: result.Invoice.CustomerRef.value,
                    displayName: result.Invoice.CustomerRef.name
                },
                lineItems: result.Invoice.Line.map((line: any) => ({
                    amount: line.Amount,
                    description: line.Description,
                    itemId: line.SalesItemLineDetail.ItemRef.value,
                    quantity: line.SalesItemLineDetail.Qty,
                    unitPrice: line.SalesItemLineDetail.UnitPrice
                })),
                syncToken: result.Invoice.SyncToken // Return new SyncToken for future updates
            });

        } catch (error) {
            console.error('Update failed:', {
                status: error.response?.status,
                data: error.response?.data,
                config: error.config
            });

            const qboError = error.response?.data?.Fault?.Error?.[0] || {};
            res.status(error.response?.status || 500).json({
                error: qboError.Message || 'Invoice update failed',
                code: qboError.code,
                detail: qboError.Detail,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }
}
