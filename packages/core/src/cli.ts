#!/usr/bin/env node
import process from 'node:process';
import { gerarChaveMestra } from './cripto.js';

const comando = process.argv[2];

if (comando === 'gerar-chave') {
	console.log(gerarChaveMestra());
}
else {
	console.log('Uso: npx nfse-nacional-core gerar-chave');
	console.log('  Gera uma chave-mestra (ou uma parte da chave dividida): 32 bytes aleatórios em base64.');
	process.exitCode = comando ? 1 : 0;
}
