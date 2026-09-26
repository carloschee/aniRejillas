# Rejilla de animación (web)

Crea animaciones de **rejilla de barrera** (*scanimation*, kinegrama) a partir de un video corto, un GIF animado o varias imágenes, y descarga un **PDF listo para imprimir**:

- **Página 1:** la imagen entrelazada. Va en papel.
- **Página 2:** la rejilla a hoja completa. Va en acetato y se recorta a la medida.

Todo el procesamiento ocurre **en el navegador**: los videos e imágenes no se suben a ningún servidor.

## Funciones

- Origen: video (MP4, MOV, WebM…), GIF/WebP animado, varias imágenes, una carpeta o el demo.
- Selección de cuadros: desde, hasta y "1 de cada N" (máximo 10), con detección exacta de cuadros del video.
- Edición: rotar 90°, reflejar ↔ ↕ e invertir el orden.
- Imagen en blanco y negro con umbral (recomendado), escala de grises o color; invertir colores.
- Rejilla de barras verticales u horizontales, o **disco polar** para girar.
- Franja en mm, 300 o 600 dpi y botón **Sugerir** (periodo ≈ 3.6 mm).
- Hoja carta o media carta, vertical, horizontal o automática según los cuadros.
- Simulación animada en vivo y medidas (periodo, tamaño, sectores) con avisos.
- PDF **sin pérdida**: en blanco y negro se guarda en 1 bit y queda muy ligero.
- PWA: se puede instalar y usar sin conexión.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub, por ejemplo `rejilla-animacion`.
2. Sube **el contenido de esta carpeta** a la raíz del repositorio: `index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`, `sw.js`, `.nojekyll` y `README.md`.
   - Desde la web de GitHub usa *Add file → Upload files* y arrastra todo. Si `.nojekyll` no aparece, créalo vacío con *Add file → Create new file*.
   - O desde la terminal:
     ```bash
     git init && git add . && git commit -m "Rejilla de animación web"
     git branch -M main
     git remote add origin https://github.com/TU_USUARIO/rejilla-animacion.git
     git push -u origin main
     ```
3. En el repositorio ve a **Settings → Pages → Build and deployment**, elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`, y guarda.
4. En uno o dos minutos la app queda en `https://TU_USUARIO.github.io/rejilla-animacion/`.

Al publicar cambios, sube el número de `VERSION` en `sw.js` (por ejemplo `rejilla-v2`) para que quien la tenga instalada reciba la versión nueva.

## Probar en tu computadora

Los módulos de JavaScript no funcionan abriendo el archivo con doble clic; hace falta un servidor local:

```bash
python -m http.server 8000
```

Luego abre `http://localhost:8000`.

## Compatibilidad

- **Chrome y Edge** (escritorio y Android): todo.
- **Firefox y Safari**: todo. Si el navegador no puede leer un video (por su códec), conviértelo a MP4 H.264 o WebM. En navegadores sin `ImageDecoder`, los GIF se leen con [gifuct-js](https://github.com/matt-way/gifuct-js), que se descarga de jsDelivr solo en ese caso.
- A 600 dpi en hoja carta se usan unos cientos de MB de memoria. En celulares modestos conviene 300 dpi o media carta.

## Cómo imprimir

1. Página 1 en papel y página 2 en acetato, ambas al **100 % / tamaño real** (sin "ajustar a página").
2. Recorta la rejilla más grande que la imagen, ponla encima y deslízala. En modo polar, recorta el disco por la línea circular, perfora el centro y fíjalo sobre la cruz con un broche o una chinche.

## Estructura

```
index.html            interfaz
css/styles.css        estilos (claro/oscuro, adaptable a celular)
js/core.js            motor: medidas, entrelazado, rejillas, simulación y escritor de PDF
js/app.js             interfaz, lectura de video/GIF/imágenes, vista previa
js/worker.js          genera el PDF en segundo plano
sw.js, manifest.webmanifest, icons/   PWA
```
