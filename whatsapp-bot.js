import express from "express";
import pkg from "maher-zubair-baileys";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import QRCode from "qrcode";
import nodemailer from "nodemailer";
import { addOrder } from "./firebase-dao.js";
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
let qrGenerated = false;
let isConnected = false;
let currentConnection = null;
let messageHandlerActive = false;

// Add message deduplication
const processedMessages = new Set();
// Set a reasonable expiration time for processed message IDs
const MESSAGE_EXPIRY_MS = 30000; // 30 seconds

// Add this function to generate dynamic menu text
function generateMenuText() {
  let menuText = `Welcome to Tandoorbaaz! 🔥\n\nOur Menu:\n`;

  Object.entries(menuItems).forEach(([key, item]) => {
    menuText += `${key}. ${item.name} - ₹${item.price}\n`;
  });

  menuText += `\nReply with item number to select (e.g. "2" for TANDOORI CHICKEN)`;

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

  console.log("📧 QR code sent to email (one-time)");
}

// Configure axios with timeout
axios.defaults.timeout = 30000; // 30 second timeout

async function connectToWhatsApp() {
  // Don't clear sessions - keep them persistent
  console.log("Using existing session if available...");

  // Clean up previous connection if it exists
  if (currentConnection) {
    try {
      console.log("Cleaning up previous connection...");
      currentConnection.ev.removeAllListeners();
    } catch (error) {
      console.error("Error cleaning up previous connection:", error);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

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
      delayBetweenTriesMs: 5000,
    },
  });

  // Store current connection for cleanup on reconnect
  currentConnection = sock;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMessage =
        lastDisconnect?.error?.output?.payload?.message || "Unknown error";

      console.log(
        "Connection closed due to:",
        errorMessage,
        "Status code:",
        statusCode
      );

      if (
        statusCode === DisconnectReason.loggedOut ||
        errorMessage.includes("invalid") ||
        errorMessage.includes("expired")
      ) {
        console.log(
          "Session expired or invalid. Will need new QR code on reconnection."
        );
      }

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("Attempting to reconnect in 5 seconds...");
        // Reset message handler flag
        messageHandlerActive = false;
        setTimeout(() => {
          connectToWhatsApp(); // Reconnect with delay
        }, 5000);
      } else {
        console.log("Not reconnecting - user logged out");
      }
    }

    if (qr && !qrGenerated) {
      qrGenerated = true;
      await sendQrCodeEmail(qr);
      console.log("🔄 QR Code generated - check your email or terminal");
    }

    if (connection === "open") {
      isConnected = true;
      qrGenerated = false; // Reset QR flag for next session
      console.log("✅ Connection established successfully!");

      // Only set up message handler if not already active
      if (!messageHandlerActive) {
        messageHandlerActive = true;
        handleMessages(sock);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

// Periodically clean up the processed messages set
function cleanupProcessedMessages() {
  const now = Date.now();
  // Clean up expired message IDs
  for (const item of processedMessages) {
    // Format is "msgId:timestamp"
    const [, timestamp] = item.split(":");
    if (now - parseInt(timestamp) > MESSAGE_EXPIRY_MS) {
      processedMessages.delete(item);
    }
  }
}

setInterval(cleanupProcessedMessages, 60000); // Run cleanup every minute

async function handleMessages(sock) {
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const message = messages[0];
      if (!message?.key?.remoteJid) return;

      // Filter out status messages/broadcasts
      if (message.key.remoteJid === "status@broadcast") return;

      // Implement message deduplication
      const messageId = message.key.id;
      const timestamp = Date.now();
      const dedupKey = `${messageId}:${timestamp}`;

      // Skip if we've processed this message recently
      if (processedMessages.has(dedupKey)) {
        console.log(`Skipping duplicate message: ${messageId}`);
        return;
      }

      // Mark this message as processed
      processedMessages.add(dedupKey);

      const userNumber = message.key.remoteJid.split("@")[0];
      const userResponse =
        message.message?.conversation?.toLowerCase() ||
        message.message?.extendedTextMessage?.text?.toLowerCase();

      if (!userResponse) return;

      console.log(`Received message from ${userNumber}: ${userResponse}`);

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
  });
}

// Add health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    connected: isConnected,
    timestamp: new Date().toISOString(),
  });
});

app.use(express.static(path.join(__dirname, "pay.html")));

const PORT = 3010;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  setTimeout(() => {
    connectToWhatsApp();
  }, 1000);
});
