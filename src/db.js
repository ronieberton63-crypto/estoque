import PouchDB from 'pouchdb/dist/pouchdb.js';

// 1. Banco Local (sempre disponível, mesmo sem servidor ou sem Wi-Fi)
const localDB = new PouchDB('estoque_escola_local');

// 2. Configurações do Servidor Remoto
const USER = 'admin';
const PASS = 'colegio123';
const SERVER_IP = '10.32.145.97';
const DB_NAME = 'estoque_escola_remoto';

const remoteURL = `http://${USER}:${PASS}@${SERVER_IP}:5984/${DB_NAME}`;

let syncHandler = null;

function iniciarSincronizacao() {
  if (syncHandler) syncHandler.cancel();

  // Conecta de forma resiliente ao banco remoto
  const remoteDB = new PouchDB(remoteURL, { skip_setup: true });

  syncHandler = localDB.sync(remoteDB, {
    live: true,
    retry: true, // Continua tentando reconectar automaticamente em segundo plano
    back_off_function: () => 10000 // Tenta a cada 10 segundos sem travar a interface
  })
  .on('change', (info) => {
    console.log('🔄 Sincronização realizada com sucesso:', info);
  })
  .on('paused', (err) => {
    if (err) {
      console.log('🔴 Servidor desligado ou sem rede. Operando 100% offline.');
    } else {
      console.log('🟢 Conectado e sincronizado com o servidor!');
    }
  })
  .on('active', () => {
    console.log('🔄 Enviando/recebendo atualizações com o servidor...');
  })
  .on('denied', (err) => {
    console.error('⛔ Permissão negada no servidor:', err);
  })
  .on('error', (err) => {
    console.log('🟡 Servidor inacessível no momento. Mantendo dados locais.');
  });
}

// Inicia o processo de sincronização contínua
iniciarSincronizacao();

export default localDB;