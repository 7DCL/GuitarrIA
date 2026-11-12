// Copia a public/ los archivos estáticos de las librerías: el modelo de Basic Pitch
// y la fuente musical de alphaTab (partitura).
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('public/model', { recursive: true });
cpSync('node_modules/@spotify/basic-pitch/model', 'public/model', { recursive: true });
mkdirSync('public/alphatab/font', { recursive: true });
cpSync('node_modules/@coderline/alphatab/dist/font', 'public/alphatab/font', { recursive: true });
console.log('Modelo y fuente de partitura copiados a public/');
