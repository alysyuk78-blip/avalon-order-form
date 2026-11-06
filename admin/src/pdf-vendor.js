// Бібліотека PDF для рахунків (окремий файл public/admin/assets/pdf-lib.js, вантажиться на вимогу).
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

window.AvalonPdfLib = { PDFDocument, rgb, fontkit };
