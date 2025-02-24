import express from "express";
import pkg from "maher-zubair-baileys";
import qrcode from "qrcode";
import { writeFile } from "fs/promises";

const app = express();
app.use(express.json());
const { makeWASocket, useMultiFileAuthState } = pkg;

let sock = null;
let isConnected = false;
let qrPath = "";

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["Linux", "Chrome", "1.0.0"],
    version: [2, 2424, 6],
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrFileName = `qr-${Date.now()}.png`;
      qrPath = `/qr/${qrFileName}`;
      await writeFile(`./public${qrPath}`, await qrcode.toBuffer(qr));
      isConnected = false;
    }

    if (connection === "close") {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === "open") {
      isConnected = true;
      console.log("✅ Connection established successfully!");
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

// Serve QR codes
app.use("/qr", express.static("public/qr"));

app.post("/send/:number", async (req, res) => {
  const number = req.params.number;
  const { message } = req.body;

  if (!number || !message) {
    return res.status(400).json({
      status: "error",
      message: "Number and message are required",
    });
  }

  if (!isConnected) {
    return res.json({
      status: "need_login",
      message: "Session expired or not connected",
      qr_url: `http://localhost:3000${qrPath}`,
    });
  }

  try {
    const jid = `${number}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    res.json({
      status: "success",
      message: "Message sent successfully",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});







app.post("/buy/:number", async (req, res) => {
  const number = req.params.number;
  const { message } = req.body;

  if (!isConnected) {
    return res.json({
      status: "need_login",
      message: "Session expired or not connected",
      qr_url: `http://localhost:3000${qrPath}`,
    });
  }

  try {
    const jid = `${number}@s.whatsapp.net`;

    // Send initial message
    await sock.sendMessage(jid, { text: message });

    // Send menu options
    const menuMessage = `Welcome to Tandoorbaaz! 🍽️
    
1. View Menu 📋
2. Place Order 🛒
3. Track Order 🔍
    
Reply with a number to continue`;

    await sock.sendMessage(jid, { text: menuMessage });

    // Listen for responses
    sock.ev.on("messages.upsert", async ({ messages }) => {
      const userResponse = messages[0].message.conversation;

      if (userResponse === "1") {
        // Send product menu
        const menu =
          "Our Menu:\n1. Tandoori Roti - ₹20\n2. Butter Naan - ₹40\n3. Paneer Tikka - ₹180";
        await sock.sendMessage(jid, { text: menu });
      }

      if (userResponse === "2") {
        // Start order process
        const order = {
          id: Date.now(),
          customer: number,
          status: "new",
        };
        console.log("New order initiated:", order);
      }
    });

    res.json({
      status: "success",
      message: "Interactive chat initiated",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});





sock.ev.on("messages.upsert", async ({ messages }) => {
  const message = messages[0];
  const userNumber = message.key.remoteJid.split("@")[0];
  const userResponse = message.message.conversation.toLowerCase();

  if (userResponse === "hello") {
    const welcomeMessage = `Welcome to Tandoorbaaz! 🔥
Our Menu:
1. CHICKEN SEEKH KEBAB - QTR(1PC) - ₹59
2. TANDOORI CHICKEN - QTR(2PC) - ₹89
3. CHICKEN TIKKA - HALF(8PC) - ₹149

Reply with item number and quantity (e.g. "1 2" for 2 CHICKEN SEEKH KEBAB)`;

    await sock.sendMessage(message.key.remoteJid, { text: welcomeMessage });
  }

  const menuItems = {
    1: { name: "CHICKEN SEEKH KEBAB - QTR(1PC)", price: 59 },
    2: { name: "TANDOORI CHICKEN - QTR(2PC)", price: 89 },
    3: { name: "CHICKEN TIKKA - HALF(8PC)", price: 149 },
  };

  const orderMatch = userResponse.match(/^([1-3])\s+(\d+)$/);
  if (orderMatch) {
    const [_, itemNum, quantity] = orderMatch;
    const item = menuItems[itemNum];
    const total = item.price * parseInt(quantity);

    const order = {
      id: Date.now(),
      items: [
        {
          id: parseInt(itemNum),
          name: item.name,
          price: item.price,
          quantity: parseInt(quantity),
        },
      ],
      total: total,
      timestamp: new Date().toISOString(),
      customerDetails: {
        phone: userNumber,
        orderTime: new Date().toLocaleString("en-IN"),
      },
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    console.log("New order received:", {
      orderId: order.id,
      customerPhone: userNumber,
      total: total,
    });

    // Save order to orders.json
    const ordersFile = path.join(__dirname, "orders.json");
    let orders = [];
    if (fs.existsSync(ordersFile)) {
      orders = JSON.parse(fs.readFileSync(ordersFile, "utf8"));
    }
    orders.push(order);
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));

    await sock.sendMessage(message.key.remoteJid, {
      text: `Order Confirmed! ✅\nOrder ID: ${order.id}\nTotal: ₹${total}\nThank you for ordering with Tandoorbaaz! 🙏`,
    });
  }
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  connectToWhatsApp();
});
