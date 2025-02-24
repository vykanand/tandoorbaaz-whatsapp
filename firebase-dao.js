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
} from "firebase/firestore";

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

export { addOrder, getOrders, updateOrder };
