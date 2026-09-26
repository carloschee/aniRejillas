// worker.js — genera el PDF a resolución de impresión sin congelar la página.
import { generatePdf } from './core.js';

self.onmessage = async (e) => {
  const { sources, opts, lay } = e.data;
  try {
    const pdf = await generatePdf(sources, opts, lay, (msg) => self.postMessage({ type: 'progress', msg }));
    self.postMessage({ type: 'done', pdf }, [pdf.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', msg: (err && err.message) || String(err) });
  }
};
