const express = require("express");
const multer = require("multer");
const cors = require("cors");
const axios = require("axios");
const FormData = require("form-data");
const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  })
});

const db = admin.firestore();

const app = express();
const BOT_TOKEN = "8610559635:AAEHN9-OEPDnSvvQLZmIXZ0l_mC65ZnU0yo";
const CHANNEL_ID = "-1003937995806";

app.use(cors());

// memory storage
const upload = multer({ storage: multer.memoryStorage() });

// home route
app.get("/", (req, res) => {
    res.send("Demon Drive Backend Running 🚀");
});

// upload route
app.post("/upload", upload.single("file"), async (req, res) => {
    console.log("📥 Upload received");

    if (!req.file) {
        return res.status(400).json({ error: "No file received" });
    }

    try {
        const name = req.file.originalname.toLowerCase();

        let endpoint = "sendDocument";
        let field = "document";

        // detect file type
        if (name.match(/\.(mp4|webm|mov)$/)) {
            endpoint = "sendVideo";
            field = "video";
        } 
        else if (name.match(/\.(mp3|wav|ogg)$/)) {
            endpoint = "sendAudio";
            field = "audio";
        }

        const form = new FormData();

        form.append("chat_id", CHANNEL_ID);
        form.append(field, req.file.buffer, req.file.originalname);

        const response = await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/${endpoint}`,
            form,
            { headers: form.getHeaders() }
        );

        console.log("✅ Sent to Telegram");

        // generate file URL (Telegram CDN style)
        const fileId =
            response.data.result.document?.file_id ||
            response.data.result.video?.file_id ||
            response.data.result.audio?.file_id;

        const fileInfo = await axios.get(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
        );

        const filePath = fileInfo.data.result.file_path;

        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

        // save to DB
        // save to DB
        await db.collection("files").add({
            name: req.file.originalname,
            url: fileUrl,
            size: req.file.size,
            type: field,
            time: new Date().toISOString(),
            messageId: response.data.result.message_id
        });

        console.log("DB SAVED");

        res.json({
            ok: true,
            name: req.file.originalname,
            url: fileUrl,
            type: field
        });

    } catch (err) {
        console.log("❌ Telegram error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// get all files
app.get("/files", async (req, res) => {

    const snapshot = await db
        .collection("files")
        .orderBy("time", "desc")
        .get();

    const files = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    res.json(files);
});

// start server
const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

app.delete("/delete/:id", async (req, res) => {

    const docId = req.params.id;

    try {

        const docRef = db.collection("files").doc(docId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return res.status(404).json({
                error: "File not found"
            });
        }

        const file = docSnap.data();

        // delete Telegram message
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`,
            {
                chat_id: CHANNEL_ID,
                message_id: file.messageId
            }
        );

        // delete Firestore document
        await docRef.delete();

        res.json({
            ok: true
        });

    } catch (err) {

        console.log(err.message);

        res.status(500).json({
            error: err.message
        });
    }
});
