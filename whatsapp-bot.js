import express from "express";
import pkg from "maher-zubair-baileys";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import QRCode from "qrcode";
import nodemailer from "nodemailer";
import { addOrder, getOrders, updateOrder } from "./firebase-dao.js";


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

let isConnected = false;
const userOrders = new Map();
const userOrderState = new Map();

const menuItems = {
  1: { name: "CHICKEN SEEKH KEBAB - QTR(1PC)", price: 59 },
  2: { name: "TANDOORI CHICKEN - QTR(2PC)", price: 89 },
  3: { name: "CHICKEN TIKKA - HALF(8PC)", price: 149 },
};

// Add this function to generate dynamic menu text
function generateMenuText() {
  let menuText = `Welcome to Tandoorbaaz! 🔥\n\nOur Menu:\n`;

  Object.entries(menuItems).forEach(([key, item]) => {
    menuText += `${key}. ${item.name} - ₹${item.price}\n`;
  });

  menuText += `\nReply with item number to select (e.g. "2" for TANDOORI CHICKEN)`;

  return menuText;
}


async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["WhatsApp Desktop", "Desktop", "1.0.0"],
    version: [2, 2308, 7],
    connectTimeoutMs: 60000,
    qrTimeout: 40000,
    defaultQueryTimeoutMs: 60000,
    retryRequestDelayMs: 2000,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log(
        "Connection closed due to ",
        lastDisconnect?.error?.output?.payload?.message
      );
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    }

    if (qr) {
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

    if (connection === "open") {
      isConnected = true;
      console.log("✅ Connection established!");

      sock.ev.on("messages.upsert", async ({ messages }) => {
         const message = messages[0];
         if (!message?.key?.remoteJid) return;

         const userNumber = message.key.remoteJid.split("@")[0];
         const userResponse =
           message.message?.conversation?.toLowerCase() ||
           message.message?.extendedTextMessage?.text?.toLowerCase();


        console.log("🔍 Message Debug:", {
          content: userResponse,
          fromMe: message.key.fromMe,
          number: userNumber,
          state: userOrderState.get(userNumber),
        });

        if (!userResponse) {
          console.log("📝 Skipping empty message");
          return;
        }

        console.log(`📩 Processing message: ${userResponse}`);
        console.log(`🔄 Current state: ${userOrderState.get(userNumber)}`);

        if (
          userResponse === "hello" ||
          userResponse === "menu" ||
          userResponse === "order"
        ) {
          // Add delay between messages to prevent rate limiting
          await new Promise((resolve) => setTimeout(resolve, 1000));

          userOrderState.set(userNumber, "awaitingMenuChoice");
          // const welcomeMessage = `Welcome to Tandoorbaaz! 🔥
          // Our Menu:
          // 1. CHICKEN SEEKH KEBAB - QTR(1PC) - ₹59
          // 2. TANDOORI CHICKEN - QTR(2PC) - ₹89
          // 3. CHICKEN TIKKA - HALF(8PC) - ₹149

          // Reply with item number to select (e.g. "2" for TANDOORI CHICKEN)`;
          // await sock.sendMessage(
          //   message.key.remoteJid,
          //   {
          //     text: welcomeMessage,
          //     detectLinks: true,
          //   },
          //   { quoted: message }
          // );
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
          /^[1-3]$/.test(userResponse)
        ) {
          const selectedItem = menuItems[userResponse];
          userOrders.set(userNumber, userResponse);
          userOrderState.set(userNumber, "awaitingQuantity");

          console.log(
            `🛒 Selected menu item ${userResponse}: ${selectedItem.name}`
          );
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

          console.log(`📦 Processing order - Quantity: ${quantity}`);

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

          try { await addOrder(order); } catch (e) { console.error(e); }

          // const ordersFile = path.join(__dirname, "./orders.json");
          // let orders = [];
          // if (fs.existsSync(ordersFile)) {
          //   orders = JSON.parse(fs.readFileSync(ordersFile, "utf8"));
          // }
          // orders.push(order);
          // fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));

          await sock.sendMessage(message.key.remoteJid, {
            text: `Order Confirmed! ✅\nOrder ID: ${order.id}\nItem: ${item.name}\nQuantity: ${quantity}\nTotal: ₹${total}\n\n 📞\nThank you for ordering from Tandoorbaaz! 🙏`,
          });

          const paymentWebUrl = `https://www.tandoorbaaz.shop/buy/pay.html/?amount=${total}&orderId=${order.id}`;
          await sock.sendMessage(message.key.remoteJid, {
            text: `Click here to pay ₹${total}: ${paymentWebUrl}\n\nChoose your preferred payment app 📱 and Make the payment! 💰`,
          });

          userOrderState.delete(userNumber);
          userOrders.delete(userNumber);
          return;
        }
      });
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

app.use(express.static(path.join(__dirname, "pay.html")));


const PORT = 3010;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  connectToWhatsApp();
});
