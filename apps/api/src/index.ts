import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(`API Boulangerie Lomoto démarrée sur http://localhost:${port}`);
});
