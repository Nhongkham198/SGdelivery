
import { CartItem, LocationState } from '../types';

export interface PrintOrderPayload {
  orderId?: string;
  customerName: string;
  customerPhone: string;
  items: CartItem[];
  total: number;
  note?: string;
  timestamp: string;
}

// Function to check if the print server is reachable
export const checkServerHealth = async (serverUrl: string): Promise<boolean> => {
  try {
    // Set a short timeout (2 seconds) to avoid hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${serverUrl}/`, { 
        method: 'GET',
        signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    return false;
  }
};

export const sendToPrintServer = async (payload: PrintOrderPayload, serverUrl: string) => {
  try {
    // 1. Format data into simple text lines (as expected by your server.js logic)
    // Your server.js iterates over `order.items` and sends them as lines.
    
    const lines: string[] = [];

    // Header
    lines.push("SeoulGood Delivery"); // Big Text handled by server commands usually, but here we send content
    lines.push("================================");
    lines.push(`Order ID: ${payload.orderId || 'Offline'}`);
    lines.push(`Time: ${payload.timestamp}`);
    lines.push("--------------------------------");
    
    // Customer
    lines.push(`K. ${payload.customerName}`);
    lines.push(`Tel: ${payload.customerPhone}`);
    lines.push("--------------------------------");

    // Items
    payload.items.forEach(item => {
        // Line 1: Name x Qty
        lines.push(`${item.name} x${item.quantity}`);
        
        // Options
        if (item.selectedOptions && Object.keys(item.selectedOptions).length > 0) {
            const opts = Object.values(item.selectedOptions).join(',');
            lines.push(`  (${opts})`);
        }

        // Note
        if (item.note) {
            lines.push(`  * ${item.note}`);
        }
    });

    lines.push("--------------------------------");
    
    // Total
    lines.push(`TOTAL: ${payload.total} THB`);
    lines.push("================================");
    lines.push("\n"); // Extra feed

    // 2. Prepare payload matching server.js expectation
    // server.js expects: { order: { orderId: ..., items: [...] }, paperSize: ... }
    const body = {
        order: {
            orderId: payload.orderId || 'NEW',
            items: lines 
        },
        paperSize: '80mm'
    };

    // 3. Send to Print Server
    const response = await fetch(`${serverUrl}/print`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error('Print Server Error');
    }

    return await response.json();

  } catch (error) {
    console.error("Printing failed:", error);
    throw error;
  }
};
