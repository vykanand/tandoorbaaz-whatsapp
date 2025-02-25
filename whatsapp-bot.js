import express from "express";
import pkg from "maher-zubair-baileys";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import QRCode from "qrcode";
import nodemailer from "nodemailer";
import { addOrder, saveCredsToFirestore } from "./firebase-dao.js";
import axios from "axios";

const { makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;

const emailConfig = {
  service: "gmail",
  auth: {
    user: "vykanand@gmail.com",
    pass: "brqj ftms ktah jyqk",
  },
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const menuItems = {
  1: { name: "CHICKEN SEEKH KEBAB - QTR(1PC)", price: 59 },
  2: { name: "CHICKEN TIKKA - QTR(4PC)", price: 79 },
  3: { name: "TANDOORI CHICKEN - QTR(2PC)", price: 89 },
  4: { name: "AFGHANI CHICKEN - QTR(2PC)", price: 109 },
  5: { name: "CHICKEN WINGS - QTR(2PC)", price: 69 },
  6: { name: "CHICKEN TANGDI - QTR(2PC)", price: 99 },
  7: { name: "AFGHANI TANGDI - QTR(2PC)", price: 119 },
  8: { name: "FISH TIKKA - 6PC", price: 119 },
  9: { name: "MASALA CHAAP - HALF(3PC)", price: 69 },
  10: { name: "MALAI CHAAP - HALF(3PC)", price: 79 },
  11: { name: "AFGHANI CHAAP - HALF(3PC)", price: 79 },
  12: { name: "PANEER TIKKA - 4PC", price: 79 },
  13: { name: "RUMALI ROTI", price: 10 },
};

const userOrders = new Map();
const userOrderState = new Map();
// Track processed message IDs to prevent duplicates
const processedMessageIds = new Set();
// Throttle time in milliseconds (2 seconds)
const THROTTLE_TIME = 2000;
// Track last message time for each user
const userLastMessageTime = new Map();

let qrGenerated = false;
let isConnected = false;
let globalSock = null;
// Flag to prevent multiple connection attempts
let isConnecting = false;
// Flag to track if credentials have been saved in current session
let credsSavedThisSession = false;

// Function to generate dynamic menu text
function generateMenuText() {
  let menuText = `Welcome to Tandoorbaaz! 🔥\n\nOur Menu:\n`;

  Object.entries(menuItems).forEach(([key, item]) => {
    menuText += `${key}. ${item.name} - ₹${item.price}\n`;
  });

  menuText += `\nReply with item number to select (e.g. "2" for CHICKEN TIKKA)`;

  return menuText;
}

async function sendQrCodeEmail(qr) {
  const qrImage = await QRCode.toDataURL(qr);
  const transporter = nodemailer.createTransport(emailConfig);

  await transporter.sendMail({
    from: "vykanand@gmail.com",
    to: "vykanand@gmail.com", 
    subject: "TandoorBaaz Bot - New Login QR Code",
    html: `<h2>Scan this QR code to reconnect the bot</h2>`,
    attachments: [
      {
        filename: "qr-code.png",
        content: qrImage.split("base64,")[1],
        encoding: "base64",
      },
    ],
  });

  console.log("📧 QR code sent to email");
}

// Enhanced message processing with robust deduplication
async function processMessage(sock, message) {
  try {
    if (!message?.key?.remoteJid || !message?.key?.id) return;
    
    // Filter out status messages/broadcasts
    if (message.key.remoteJid === "status@broadcast") return;

    // Create a unique message ID for deduplication
    const messageId = `${message.key.remoteJid}:${message.key.id}`;
    
    // Check if we've already processed this exact message
    if (processedMessageIds.has(messageId)) {
      console.log(`Message already processed, skipping: ${messageId}`);
      return;
    }
    
    const userNumber = message.key.remoteJid.split("@")[0];
    const userResponse = 
      message.message?.conversation?.toLowerCase() ||
      message.message?.extendedTextMessage?.text?.toLowerCase();

    if (!userResponse) return;
    
    // Apply throttling before any processing
    const now = Date.now();
    const lastMsgTime = userLastMessageTime.get(userNumber) || 0;
    
    if (now - lastMsgTime < THROTTLE_TIME) {
      console.log(`Throttling message from ${userNumber}: too frequent`);
      return;
    }
    
    // Immediately mark as processed and update last message time
    processedMessageIds.add(messageId);
    userLastMessageTime.set(userNumber, now);
    
    console.log(`Processing message from ${userNumber}: ${userResponse}`);

    if (
      userResponse === "hello" ||
      userResponse === "menu" ||
      userResponse === "order"
    ) {
      userOrderState.set(userNumber, "awaitingMenuChoice");
      await sock.sendMessage(
        message.key.remoteJid,
        {
          text: generateMenuText(),
          detectLinks: true,
        },
        { quoted: message }
      );
      return;
    }

    if (
      userOrderState.get(userNumber) === "awaitingMenuChoice" &&
      /^[1-9]([0-9])?$/.test(userResponse) &&
      menuItems[userResponse]
    ) {
      const selectedItem = menuItems[userResponse];
      userOrders.set(userNumber, userResponse);
      userOrderState.set(userNumber, "awaitingQuantity");

      await sock.sendMessage(message.key.remoteJid, {
        text: `You selected: ${selectedItem.name}\nPrice: ₹${selectedItem.price}\n\nHow many would you like to order? Reply with quantity.`,
      });
      return;
    }

    if (
      userOrderState.get(userNumber) === "awaitingQuantity" &&
      /^\d+$/.test(userResponse)
    ) {
      const quantity = parseInt(userResponse);
      const selectedItemId = userOrders.get(userNumber);
      const item = menuItems[selectedItemId];
      const total = item.price * quantity;

      const order = {
        id: Date.now(),
        items: [
          {
            id: parseInt(selectedItemId),
            name: item.name,
            price: item.price,
            quantity: quantity,
          },
        ],
        total: total,
        timestamp: new Date().toISOString(),
        customerDetails: {
          phone: userNumber,
          orderTime: new Date().toLocaleString("en-IN"),
        },
        createdAt: new Date().toISOString(),
        status: "confirmed",
      };

      try {
        await addOrder(order);
        console.log(`New order created: ${order.id} for ${userNumber}`);
      } catch (e) {
        console.error("Error saving order to Firebase:", e);
      }

      await sock.sendMessage(message.key.remoteJid, {
        text: `Order Confirmed! ✅\nOrder ID: ${order.id}\nItem: ${item.name}\nQuantity: ${quantity}\nTotal: ₹${total}\n\n 📞\nThank you for ordering from Tandoorbaaz! 🙏`,
      });

      const paymentWebUrl = `https://www.tandoorbaaz.shop/buy/pay.html/?amount=${total}&orderId=${order.id}`;
      await sock.sendMessage(message.key.remoteJid, {
        text: `Click here to pay ₹${total}: ${paymentWebUrl}\n\nChoose your preferred payment app 📱 and Make the payment! 💰`,
      });

      userOrderState.delete(userNumber);
      userOrders.delete(userNumber);
    }
  } catch (error) {
    console.error("Error handling message:", error);
  }
}

// Improved connection function with better cleanup
async function connectToWhatsApp() {
  // Prevent multiple simultaneous connection attempts
  if (isConnecting) {
    console.log("Connection attempt already in progress, skipping");
    return;
  }
  
  isConnecting = true;
  
  try {
    // Ensure proper cleanup of existing connection
    if (globalSock) {
      console.log("Cleaning up existing connection...");
      try {
        // Remove all event listeners from previous connection
        globalSock.ev.removeAllListeners();
        globalSock = null;
      } catch (err) {
        console.error("Error cleaning up previous connection:", err);
      }
    }

    console.log("Starting WhatsApp connection...");
    
    // Reset session tracking flags
    credsSavedThisSession = false;
    
    const { state, saveCreds: originalSaveCreds } = await useMultiFileAuthState("auth_info");
    
    // Create a custom save function that prevents duplicates
    const saveCreds = async () => {
      // Always save to local files first
      await originalSaveCreds();
      
      // Only save to Firebase once per connection session
      if (!credsSavedThisSession && globalSock?.authState?.creds) {
        try {
          await saveCredsToFirestore(globalSock.authState.creds);
          console.log("✅ WhatsApp credentials saved to Firestore");
          credsSavedThisSession = true;
        } catch (error) {
          console.error("Error saving credentials to Firebase:", error);
        }
      }
    };
    
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: ["Chrome", "Windows", "10"],
      version: [2, 2429, 7],
      connectTimeoutMs: 120000,
      qrTimeout: 60000,
      defaultQueryTimeoutMs: 120000,
      retryRequestDelayMs: 3000,
      syncFullHistory: false,
      downloadHistory: false,
      markOnlineOnConnect: false,
      transactionOpts: {
        maxCommitRetries: 3,
        delayBetweenTriesMs: 5000
      }
    });

    globalSock = sock;

    // Set up message handler with improved handling for duplicate message types
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type === 'notify') {
        if (messages && messages.length > 0) {
          for (const message of messages) {
            processMessage(sock, message);
          }
        }
      }
    });

    // Connection event handler
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.output?.payload?.message || "Unknown error";
        
        console.log(
          "Connection closed due to:",
          errorMessage,
          "Status code:",
          statusCode
        );
        
        if (statusCode === DisconnectReason.loggedOut || 
            errorMessage.includes("invalid") || 
            errorMessage.includes("expired")) {
          console.log("Session expired or invalid. Will need new QR code on reconnection.");
        }
        
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          console.log("Attempting to reconnect in 5 seconds...");
          isConnected = false;
          isConnecting = false;
          
          setTimeout(connectToWhatsApp, 5000);
        } else {
          console.log("Not reconnecting - user logged out");
          isConnected = false;
          isConnecting = false;
        }
      }

      if (qr && !qrGenerated) {
        qrGenerated = true;
        await sendQrCodeEmail(qr);
        console.log("🔄 QR Code generated - check your email or terminal");
      }

      if (connection === "open") {
        isConnected = true;
        isConnecting = false;
        qrGenerated = false;
        console.log("✅ Connection established successfully!");
        
        // Save credentials after successful connection
        await saveCreds();
      }
    });

    // Credentials update handler
    sock.ev.on("creds.update", saveCreds);
    
  } catch (error) {
    console.error("Error in connection setup:", error);
    isConnecting = false;
  }
}

// Clean up stale data periodically
setInterval(() => {
  const now = Date.now();

  // Clean up throttling data older than 30 minutes
  for (const [user, time] of userLastMessageTime.entries()) {
    if (now - time > 1800000) {
      userLastMessageTime.delete(user);
    }
  }

  // Clean up processed message IDs older than 1 hour
  // This prevents memory leaks while still providing ample deduplication
  const oneHourAgo = now - 3600000;
  for (const messageId of processedMessageIds) {
    const timestamp = parseInt(messageId.split(":")[2] || "0");
    if (timestamp < oneHourAgo) {
      processedMessageIds.delete(messageId);
    }
  }

  // Keep processed message set from growing indefinitely
  if (processedMessageIds.size > 10000) {
    // If we have too many entries, clear the oldest ones
    const messagesToKeep = [...processedMessageIds].slice(-5000);
    processedMessageIds.clear();
    messagesToKeep.forEach((msg) => processedMessageIds.add(msg));
  }
}, 900000); // Run every 15 minutes

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    connected: isConnected,
    timestamp: new Date().toISOString(),
    processedMessages: processedMessageIds.size,
  });
});

// Forced reconnection endpoint (admin only)
app.post("/admin/reconnect", (req, res) => {
  // You could add authentication here
  console.log("Manual reconnection requested");

  // Force cleanup and reconnection
  if (globalSock) {
    try {
      globalSock.ev.removeAllListeners();
      globalSock = null;
    } catch (err) {
      console.error("Error during forced cleanup:", err);
    }
  }

  isConnecting = false;
  isConnected = false;

  // Schedule reconnection
  setTimeout(connectToWhatsApp, 1000);

  res.status(200).json({
    status: "reconnecting",
    timestamp: new Date().toISOString(),
  });
});

app.use(express.static(path.join(__dirname, "pay.html")));

const PORT = 3010;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Add a delay before first connection attempt
  setTimeout(connectToWhatsApp, 1000);
});
