import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
  updateDoc,
  setDoc,
  getDoc,
} from "firebase/firestore";
import os from "os"; // Import OS module in ES module style

const firebaseConfig = {
  apiKey: "AIzaSyAEKHWdRyzI8WyBeGeesjDrM-nEzOXCuNk",
  authDomain: "billion1-a9324.firebaseapp.com",
  projectId: "billion1-a9324",
  storageBucket: "billion1-a9324.firebasestorage.app",
  messagingSenderId: "443716692865",
  appId: "1:443716692865:web:96813fe32a44f8342cd680",
  measurementId: "G-FE7NFHY5PG",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Original functions for order management
async function addOrder(orderData) {
  try {
    const docRef = await addDoc(collection(db, "bot_orders"), orderData);
    console.log("✨ Order written with ID:", docRef.id);
    return docRef.id;
  } catch (e) {
    console.error("❌ Error adding order:", e);
    throw e;
  }
}

async function getOrders(filterField = null, filterValue = null) {
  try {
    const ordersRef = collection(db, "bot_orders");
    let q = ordersRef;

    if (filterField && filterValue) {
      q = query(ordersRef, where(filterField, "==", filterValue));
    }

    const querySnapshot = await getDocs(q);
    const orders = [];

    querySnapshot.forEach((doc) => {
      orders.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    console.log("📚 Retrieved orders:", orders.length);
    return orders;
  } catch (e) {
    console.error("❌ Error reading orders:", e);
    throw e;
  }
}

async function updateOrder(orderId, updateFields) {
  try {
    await updateDoc(doc(db, "bot_orders", orderId), updateFields);
    console.log("📝 Updated order:", orderId);
    return true;
  } catch (e) {
    console.error("❌ Error updating order:", e);
    throw e;
  }
}

// WhatsApp credential storage functions

/**
 * Save WhatsApp credentials to Firestore
 * This stores a backup copy of the authentication credentials
 */
async function saveCredsToFirestore(creds) {
  try {
    // Generate a unique ID based on the machine to avoid conflicts
    const machineId = os.hostname() || "default-instance";

    await setDoc(doc(db, "whatsapp_auth", machineId), {
      creds: JSON.stringify(creds),
      updatedAt: new Date().toISOString(),
    });

    return true;
  } catch (error) {
    console.error("❌ Error saving credentials to Firestore:", error);
    throw error;
  }
}

/**
 * Retrieve WhatsApp credentials from Firestore
 * Returns null if no credentials are found
 */
async function getCredsFromFirestore() {
  try {
    const machineId = os.hostname() || "default-instance";
    const docRef = doc(db, "whatsapp_auth", machineId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      console.log("📱 Found credentials in Firestore");
      return JSON.parse(data.creds);
    } else {
      console.log("No credentials found in Firestore");
      return null;
    }
  } catch (error) {
    console.error("❌ Error getting credentials from Firestore:", error);
    return null;
  }
}

// Export all functions
export {
  addOrder,
  getOrders,
  updateOrder,
  saveCredsToFirestore,
  getCredsFromFirestore,
};
