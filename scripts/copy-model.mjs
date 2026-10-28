// Copia el modelo de Basic Pitch a public/model para servirlo como archivo estático.
import { cpSync, mkdirSync } from 'node:fs';

const src = 'node_modules/@spotify/basic-pitch/model';
mkdirSync('public/model', { recursive: true });
cpSync(src, 'public/model', { recursive: true });
console.log('Modelo copiado a public/model');
