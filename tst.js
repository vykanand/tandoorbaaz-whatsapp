import pkg from "maher-zubair-baileys";
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_test");

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

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log(
        "Connection closed due to ",
        lastDisconnect?.error?.output?.payload?.message
      );
      if (shouldReconnect) {
        connectWhatsApp();
      }
    }

    if (connection === "open") {
      console.log("Connected successfully!");
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

// Start the connection
connectWhatsApp();
