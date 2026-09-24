import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const server = createServer(async (request, response) => {
  try {
    const path = request.url === "/" ? "/index.html" : request.url.split("?")[0];
    const content = await readFile(join(process.cwd(), path));
    response.writeHead(200, { "Content-Type": `${types[extname(path)] || "application/octet-stream"}; charset=utf-8` });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("No encontrado");
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, () => console.log(`Dulce Gestión disponible en http://localhost:${port}`));
