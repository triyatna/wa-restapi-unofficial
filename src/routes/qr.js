import express from "express";
import QRCode from "qrcode";

const router = express.Router();

router.get("/qr.png", async (req, res) => {
  const data = req.query.data || "";
  if (!data) return res.status(400).send("Missing data");
  try {
    const buf = await QRCode.toBuffer(data, {
      width: 300,
      margin: 1,
      errorCorrectionLevel: "M",
    });
    res.setHeader("Content-Type", "image/png");
    res.send(buf);
  } catch (e) {
    res.status(500).send("QR encode error");
  }
});

export default router;
