import { useState, useEffect } from 'react';
import PouchDB from 'pouchdb/dist/pouchdb.js';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Configurações de Banco de Dados
const db = new PouchDB('estoque_escola_local');
const IP_DO_SERVIDOR = '127.0.0.1'; 
const USUARIO_COUCHDB = 'admin';
const SENHA_COUCHDB = 'colegio123';
const bancoRemoto = new PouchDB(`http://${USUARIO_COUCHDB}:${SENHA_COUCHDB}@${IP_DO_SERVIDOR}:5984/estoque_escola_remoto`);

function App() {
  const [abaAtiva, setAbaAtiva] = useState('limpeza'); 
  const [produtosCadastrados, setProdutosCadastrados] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [erros, setErros] = useState([]);
  const [filtroTempo, setFiltroTempo] = useState('todos');
  
  const [busca, setBusca] = useState('');

  const [novoItemNome, setNovoItemNome] = useState('');
  const [novoItemUnidade, setNovoItemUnidade] = useState('uni'); 
  const [novoItemPreco, setNovoItemPreco] = useState(''); // Preço do Produto
  const [formulariosAcao, setFormulariosAcao] = useState({}); 

  const [textoErro, setTextoErro] = useState('');
  const [respostas, setRespostas] = useState({});

  const getDataHoje = () => new Date().toISOString().split('T')[0];

  const carregarDados = async () => {
    try {
      const todos = await db.allDocs({ include_docs: true, descending: true });
      const docValidos = todos.rows.map(linha => linha.doc).filter(doc => !doc._id.startsWith('_design/'));
      setProdutosCadastrados(docValidos.filter(doc => doc.type === 'produto'));
      setRegistros(docValidos.filter(doc => doc.tipo === 'entrada' || doc.tipo === 'saida' || doc.type === 'movimentacao'));
      setErros(docValidos.filter(doc => doc.type === 'erro'));
    } catch (err) {
      console.error("Erro ao carregar dados:", err);
    }
  };

  useEffect(() => {
    carregarDados();
    const sync = db.sync(bancoRemoto, { live: true, retry: true }).on('change', (info) => {
        if (info.direction === 'pull') { carregarDados(); toast.info("🔄 Sincronizado!"); }
    });
    return () => sync.cancel();
  }, []);

  const cadastrarNovoItem = async (e) => {
    e.preventDefault();
    if (!novoItemNome) return toast.warning("Digite o nome do produto!");

    const novoProduto = {
      _id: 'prod_' + new Date().toISOString(), type: 'produto',
      nome: novoItemNome.trim().charAt(0).toUpperCase() + novoItemNome.trim().slice(1).toLowerCase(),
      unidade: novoItemUnidade,
      preco: Number(novoItemPreco) || 0,
      setor: abaAtiva
    };
    try { 
      await db.put(novoProduto); 
      toast.success("Item adicionado!"); 
      carregarDados(); 
      setNovoItemNome(''); 
      setNovoItemPreco(''); 
    } catch (erro) { toast.error("Erro ao cadastrar."); }
  };

  const getForm = (id) => formulariosAcao[id] || { qtd: '', funcionario: '', data: getDataHoje() };
  const handleFormChange = (id, campo, valor) => setFormulariosAcao({ ...formulariosAcao, [id]: { ...getForm(id), [campo]: valor } });

  const registrarAcaoCard = async (produtoCard, tipoAcao) => {
    const form = getForm(produtoCard.id);
    const qtd = Number(form.qtd);
    if (!qtd || qtd <= 0) return toast.warning("Digite uma quantidade válida!");
    if (!form.funcionario.trim()) return toast.warning("Digite o nome!");
    if (!form.data) return toast.warning("Preencha a data!");

    const novoRegistro = {
      _id: new Date().toISOString(), type: 'movimentacao', produto: produtoCard.nome,
      quantidade: qtd, tipo: tipoAcao, setor: abaAtiva, unidade: produtoCard.unidade,
      precoUnitario: produtoCard.preco, 
      funcionario: form.funcionario.trim(), dataAcao: form.data 
    };
    try {
      await db.put(novoRegistro);
      toast.success(tipoAcao === 'entrada' ? '✅ Item recebido!' : '🔻 Saída registrada!');
      carregarDados();
      setFormulariosAcao({ ...formulariosAcao, [produtoCard.id]: { qtd: '', funcionario: '', data: getDataHoje() } });
    } catch (erro) { toast.error("Erro ao registrar."); }
  };

  const excluirRegistro = async (item) => {
    if (window.confirm(`Tem certeza que deseja excluir o registro de ${item.quantidade}x ${item.produto}?`)) {
      try { await db.remove(item); toast.success("Registro excluído!"); carregarDados(); } 
      catch (err) { toast.error("Erro ao excluir."); }
    }
  };

  const registrosDaAba = registros.filter(r => r.setor === abaAtiva);

  const calcularEstoque = () => {
    const saldos = {};
    const produtosDoSetor = produtosCadastrados.filter(p => p.setor === abaAtiva);
    produtosDoSetor.forEach(p => saldos[p.nome.toLowerCase()] = { id: p._id, nome: p.nome, unidade: p.unidade, preco: p.preco || 0, quantidade: 0, setor: p.setor });
    
    registrosDaAba.forEach((item) => {
      const key = item.produto.toLowerCase();
      if (!saldos[key]) saldos[key] = { id: key, nome: item.produto, unidade: item.unidade || 'uni', preco: item.precoUnitario || 0, quantidade: 0, setor: item.setor };
      if (item.tipo === 'entrada') saldos[key].quantidade += item.quantidade;
      else if (item.tipo === 'saida') saldos[key].quantidade -= item.quantidade;
    });
    return Object.values(saldos).sort((a, b) => a.nome.localeCompare(b.nome));
  };
  
  const estoqueAtual = calcularEstoque();
  const estoqueFiltrado = estoqueAtual.filter(i => i.nome.toLowerCase().includes(busca.toLowerCase()));

  // Itens em Alerta de Estoque
  const itensEsgotados = estoqueAtual.filter(i => i.quantidade <= 0);
  const itensCriticos = estoqueAtual.filter(i => i.quantidade > 0 && i.quantidade <= 5);

  const ultimosAbastecidos = registrosDaAba.filter(item => item.tipo === 'entrada').slice(0, 4);
  const registrosFiltrados = registrosDaAba.filter((item) => {
    if (filtroTempo === 'todos') return true;
    const dataRef = item.dataAcao ? item.dataAcao : item._id.split('T')[0];
    const data = new Date(dataRef + 'T12:00:00');
    const hoje = new Date();
    if (filtroTempo === 'ano') return data.getFullYear() === hoje.getFullYear();
    if (filtroTempo === 'mes') return data.getMonth() === hoje.getMonth() && data.getFullYear() === hoje.getFullYear();
    if (filtroTempo === 'semana') {
      const inicio = new Date(hoje); inicio.setDate(hoje.getDate() - hoje.getDay()); inicio.setHours(0, 0, 0, 0); return data >= inicio;
    }
    return true;
  });

  // Cálculo Financeiro
  const valorTotalSetor = estoqueAtual.reduce((acc, item) => acc + (item.quantidade * item.preco), 0);
  const formatarMoeda = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // EXPORTAÇÕES (Atualizadas com R$)
  const exportarPDF = () => {
    const doc = new jsPDF();
    doc.text(`Relatório de Estoque - Setor: ${abaAtiva.toUpperCase()}`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} | Valor Total em Estoque: ${formatarMoeda(valorTotalSetor)}`, 14, 22);

    const colunas = ["Produto", "Qtd", "Un.", "Preço Unit.", "Valor Total"];
    const linhas = estoqueAtual.map(r => [
      r.nome,
      r.quantidade,
      r.unidade,
      formatarMoeda(r.preco),
      formatarMoeda(r.quantidade * r.preco)
    ]);

    autoTable(doc, { startY: 28, head: [colunas], body: linhas, theme: 'grid', headStyles: { fillColor: [123, 92, 255] }, styles: { fontSize: 9 } });
    doc.save(`Estoque_${abaAtiva}_${getDataHoje()}.pdf`);
    toast.success("PDF gerado com sucesso!");
  };

  const exportarRelatorioCSV = () => {
    const cabecalho = "Produto,Quantidade,Unidade,Preco Unitario,Valor Total\n";
    const linhas = estoqueAtual.map(r => `${r.nome},${r.quantidade},${r.unidade},${r.preco},${r.quantidade * r.preco}`).join("\n");
    const blob = new Blob([cabecalho + linhas], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Estoque_${abaAtiva}_${getDataHoje()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Planilha gerada com sucesso!");
  };

  const relatarErro = async (e) => {
    e.preventDefault();
    if (!textoErro) return toast.warning("Descreva o erro primeiro.");
    const novoErro = { _id: 'erro_' + new Date().toISOString(), type: 'erro', descricao: textoErro, resolvido: false, resposta: '' };
    try { await db.put(novoErro); toast.success("Erro relatado!"); setTextoErro(''); carregarDados(); } catch (err) { toast.error("Falha ao relatar erro."); }
  };
  const responderErro = async (erro) => {
    const textoResposta = respostas[erro._id];
    if (!textoResposta) return toast.warning("Digite uma resposta.");
    try { await db.put({ ...erro, resolvido: true, resposta: textoResposta }); toast.success("Resolvido!"); carregarDados(); } catch (err) { toast.error("Falha ao atualizar."); }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', fontFamily: "'Space Grotesk', sans-serif", backgroundColor: '#07070a', color: '#f4f2ee', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'fixed', inset: '-20vh -10vw', zIndex: 0, filter: 'blur(90px)', opacity: 0.35, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', width: '52vw', height: '52vw', background: '#7b5cff', borderRadius: '50%', top: '-8vh', left: '-6vw' }}></div>
        <div style={{ position: 'absolute', width: '40vw', height: '40vw', background: '#5be0ff', borderRadius: '50%', top: '24vh', right: '-8vw' }}></div>
        <div style={{ position: 'absolute', width: '34vw', height: '34vw', background: '#ff6b5b', borderRadius: '50%', bottom: '-6vh', left: '22vw' }}></div>
        <div style={{ position: 'absolute', width: '26vw', height: '26vw', background: '#c8ff4d', borderRadius: '50%', top: '52vh', left: '8vw', opacity: 0.5 }}></div>
      </div>

      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@300;400;500;600;700&display=swap');
          html, body, #root { width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; max-width: none !important; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          input:focus, select:focus, textarea:focus { outline: none; border-color: #c8ff4d !important; box-shadow: 0 0 0 3px rgba(200,255,77,0.15); }
          .menu-item { padding: 16px 22px; color: #9a97a6; cursor: pointer; transition: all 0.3s; font-weight: 400; display: flex; align-items: center; gap: 12px; font-size: 0.95rem; }
          .menu-item:hover { color: #f4f2ee; background: rgba(255,255,255,0.03); }
          .menu-item.active { background: rgba(200,255,77,0.1); color: #c8ff4d; border-left: 3px solid #c8ff4d; }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 10px; }
          .card-glass { background: linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; backdrop-filter: blur(12px); }
        `}
      </style>

      {/* MENU LATERAL */}
      <aside style={{ width: '280px', minWidth: '280px', background: '#0d0d13', borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', padding: '24px 0', zIndex: 10 }}>
        <div style={{ padding: '0 24px 28px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '20px' }}>
          <h1 style={{ color: '#f4f2ee', fontSize: '1.25rem', fontWeight: '600', letterSpacing: '0.05em' }}>🏫 Colégio Estadual</h1>
          <p style={{ color: '#9a97a6', fontSize: '0.8rem', marginTop: '4px' }}>Gestão de Estoque</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className={`menu-item ${abaAtiva === 'estatisticas' ? 'active' : ''}`} onClick={() => setAbaAtiva('estatisticas')}>📈 Painel Geral</div>
          <div className={`menu-item ${abaAtiva === 'limpeza' ? 'active' : ''}`} onClick={() => setAbaAtiva('limpeza')}>🧹 Setor de Limpeza</div>
          <div className={`menu-item ${abaAtiva === 'cozinha' ? 'active' : ''}`} onClick={() => setAbaAtiva('cozinha')}>🍳 Setor da Cozinha</div>
          <div className={`menu-item ${abaAtiva === 'secretaria' ? 'active' : ''}`} onClick={() => setAbaAtiva('secretaria')}>📎 Secretaria</div>
        </div>
        <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '20px' }}>
          <div className={`menu-item ${abaAtiva === 'erros' ? 'active' : ''}`} onClick={() => setAbaAtiva('erros')}>⚠️ Fórum de Suporte</div>
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', zIndex: 2 }}>
        <div style={{ flex: 1, padding: '40px 5%', width: '100%' }}>
          
          {/* ESTATÍSTICAS / FINANCEIRO */}
          {abaAtiva === 'estatisticas' && (
            <div>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: '400', fontFamily: '"Instrument Serif", serif', marginBottom: '30px' }}>Visão <span style={{ color: '#c8ff4d', fontStyle: 'italic' }}>Geral do Estoque</span></h2>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                <div className="card-glass" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <span style={{ color: '#9a97a6', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Capital Imobilizado (Total)</span>
                  <strong style={{ fontSize: '2.5rem', color: '#c8ff4d', fontFamily: '"Instrument Serif", serif', marginTop: '10px' }}>
                    {formatarMoeda(estoqueAtual.reduce((acc, item) => acc + (item.quantidade * item.preco), 0))}
                  </strong>
                </div>
                <div className="card-glass" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <span style={{ color: '#9a97a6', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Itens Próximos de Acabar</span>
                  <strong style={{ fontSize: '2.5rem', color: '#ffb35b', fontFamily: '"Instrument Serif", serif', marginTop: '10px' }}>
                    {estoqueAtual.filter(i => i.quantidade > 0 && i.quantidade <= 5).length} Produtos
                  </strong>
                </div>
              </div>

              <div className="card-glass" style={{ padding: '30px', height: '400px' }}>
                <h3 style={{ color: '#f4f2ee', marginBottom: '20px', fontWeight: '500' }}>Gráfico de Quantidades em Estoque</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={estoqueAtual}>
                    <XAxis dataKey="nome" stroke="#9a97a6" />
                    <YAxis stroke="#9a97a6" />
                    <Tooltip contentStyle={{ backgroundColor: '#13131a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px' }} />
                    <Bar dataKey="quantidade" fill="#7b5cff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {(abaAtiva === 'limpeza' || abaAtiva === 'cozinha' || abaAtiva === 'secretaria') && (
            <>
              {/* BANNER DE ALERTA DE ESTOQUE */}
              {(itensEsgotados.length > 0 || itensCriticos.length > 0) && (
                <div style={{ marginBottom: '30px', padding: '20px', borderRadius: '16px', background: 'rgba(255,107,91,0.1)', border: '1px solid rgba(255,107,91,0.3)' }}>
                  <h3 style={{ color: '#ff6b5b', fontSize: '1.1rem', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>⚠️ Atenção: Itens Críticos</h3>
                  <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                    {itensEsgotados.map(i => <span key={i.id} style={{ padding: '6px 12px', background: 'rgba(255,107,91,0.2)', color: '#ff6b5b', borderRadius: '8px', fontSize: '0.85rem' }}>Esgotado: {i.nome}</span>)}
                    {itensCriticos.map(i => <span key={i.id} style={{ padding: '6px 12px', background: 'rgba(255,179,91,0.2)', color: '#ffb35b', borderRadius: '8px', fontSize: '0.85rem' }}>Baixo Estoque: {i.nome} ({i.quantidade} restantes)</span>)}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '20px', marginBottom: '32px' }}>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: '400', fontFamily: '"Instrument Serif", serif', margin: 0, textTransform: 'capitalize' }}>
                  Estoque — <span style={{ color: '#c8ff4d', fontStyle: 'italic' }}>{abaAtiva}</span>
                </h2>

                <form onSubmit={cadastrarNovoItem} className="card-glass" style={{ display: 'flex', gap: '10px', padding: '10px', flexWrap: 'wrap' }}>
                  <input type="text" value={novoItemNome} onChange={(e) => setNovoItemNome(e.target.value)} placeholder="Nome do novo item..." style={{ padding: '10px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#f4f2ee', fontSize: '0.9rem', width: '200px' }} />
                  <input type="number" step="0.01" value={novoItemPreco} onChange={(e) => setNovoItemPreco(e.target.value)} placeholder="Preço (R$)" style={{ padding: '10px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#f4f2ee', fontSize: '0.9rem', width: '110px' }} />
                  <select value={novoItemUnidade} onChange={(e) => setNovoItemUnidade(e.target.value)} style={{ padding: '10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: '#13131a', color: '#f4f2ee' }}>
                    <option value="KG">KG</option><option value="L">L</option><option value="uni">uni</option><option value="PCT">PCT</option>
                  </select>
                  <button type="submit" style={{ padding: '10px 18px', background: '#c8ff4d', color: '#07070a', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '600' }}>+ Criar</button>
                </form>
              </div>

              <input type="text" placeholder="🔍 Pesquisar produto rápido..." value={busca} onChange={e => setBusca(e.target.value)} style={{ padding: '14px 20px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.4)', color: '#f4f2ee', fontSize: '1rem', width: '100%', marginBottom: '30px' }} />

              <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap', marginBottom: '40px', width: '100%' }}>
                <div style={{ flex: '3', minWidth: '300px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                    {estoqueFiltrado.map((item, index) => {
                      let statusColor = '#c8ff4d', statusBg = 'rgba(200,255,77,0.1)', statusMsg = "Estoque OK";
                      if (item.quantidade <= 0) { statusColor = '#ff6b5b'; statusBg = 'rgba(255,107,91,0.1)'; statusMsg = "Esgotado"; } 
                      else if (item.quantidade <= 5) { statusColor = '#ffb35b'; statusBg = 'rgba(255,179,91,0.1)'; statusMsg = "Crítico"; }

                      const formCard = getForm(item.id);

                      return (
                        <div key={index} className="card-glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <h3 style={{ margin: '0 0 2px 0', fontSize: '1.15rem', color: '#f4f2ee', fontWeight: '500' }}>{item.nome} <span style={{ color: '#9a97a6', fontSize: '0.8rem' }}>({item.unidade})</span></h3>
                              {item.preco > 0 && <span style={{ color: '#7b5cff', fontSize: '0.8rem', fontWeight: '600' }}>{formatarMoeda(item.preco)} / {item.unidade}</span>}
                            </div>
                            <span style={{ backgroundColor: statusBg, color: statusColor, padding: '4px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: '600' }}>{statusMsg}</span>
                          </div>
                          
                          <div style={{ fontSize: '2.8rem', fontWeight: '400', fontFamily: '"Instrument Serif", serif', color: '#f4f2ee', margin: '8px 0 16px 0' }}>
                            {item.quantidade}
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px', marginTop: 'auto' }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <input type="number" min="1" placeholder="Qtd" value={formCard.qtd} onChange={(e) => handleFormChange(item.id, 'qtd', e.target.value)} style={{ width: '70px', padding: '8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#f4f2ee', textAlign: 'center', fontSize: '0.9rem' }} />
                              <input type="text" placeholder="Funcionário" value={formCard.funcionario} onChange={(e) => handleFormChange(item.id, 'funcionario', e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#f4f2ee', fontSize: '0.9rem' }} />
                            </div>
                            <input type="date" value={formCard.data} onChange={(e) => handleFormChange(item.id, 'data', e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#9a97a6', fontSize: '0.9rem' }} />
                            
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                              <button onClick={() => registrarAcaoCard(item, 'entrada')} style={{ flex: 1, background: 'rgba(200,255,77,0.15)', color: '#c8ff4d', border: '1px solid rgba(200,255,77,0.3)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem', padding: '10px 0' }}>
                                + Recebido
                              </button>
                              <button onClick={() => registrarAcaoCard(item, 'saida')} style={{ flex: 1, background: 'rgba(255,107,91,0.15)', color: '#ff6b5b', border: '1px solid rgba(255,107,91,0.3)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem', padding: '10px 0' }}>
                                - Saiu
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {estoqueFiltrado.length === 0 && <div className="card-glass" style={{ padding: '40px', textAlign: 'center', color: '#9a97a6', gridColumn: '1 / -1' }}>Nenhum item cadastrado.</div>}
                  </div>
                </div>

                <div style={{ flex: '1', minWidth: '300px' }}>
                  <div className="card-glass" style={{ padding: '24px', height: 'fit-content' }}>
                    <h3 style={{ fontSize: '1.1rem', color: '#f4f2ee', margin: '0 0 20px 0', fontWeight: '500' }}>📦 Recém Recebidos</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {ultimosAbastecidos.map(item => (
                        <div key={item._id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
                          <div>
                            <div style={{ color: '#f4f2ee', fontSize: '0.95rem', fontWeight: '500' }}>{item.produto}</div>
                            <div style={{ color: '#9a97a6', fontSize: '0.75rem', marginTop: '2px' }}>Por: {item.funcionario || 'N/A'}</div>
                            <div style={{ color: '#9a97a6', fontSize: '0.75rem' }}>{item.dataAcao ? item.dataAcao.split('-').reverse().join('/') : ''}</div>
                          </div>
                          <div style={{ color: '#c8ff4d', fontWeight: '600', fontSize: '1rem' }}>+{item.quantidade} <small>{item.unidade}</small></div>
                        </div>
                      ))}
                      {ultimosAbastecidos.length === 0 && <span style={{ color: '#9a97a6', fontSize: '0.85rem' }}>Nenhuma entrada recente.</span>}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '1.2rem', color: '#f4f2ee', margin: 0, fontWeight: '500' }}>Histórico de Movimentações</h3>
                  <div style={{ display: 'flex', gap: '15px' }}>
                    <button onClick={exportarPDF} style={{ padding: '8px 16px', borderRadius: '10px', background: 'rgba(123,92,255,0.1)', color: '#7b5cff', border: '1px solid rgba(123,92,255,0.3)', cursor: 'pointer', fontWeight: '600' }}>📑 Exportar PDF</button>
                    <button onClick={exportarRelatorioCSV} style={{ padding: '8px 16px', borderRadius: '10px', background: 'rgba(91,224,255,0.1)', color: '#5be0ff', border: '1px solid rgba(91,224,255,0.3)', cursor: 'pointer', fontWeight: '600' }}>📄 Exportar CSV</button>
                    
                    <select value={filtroTempo} onChange={(e) => setFiltroTempo(e.target.value)} style={{ padding: '8px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', background: '#13131a', color: '#f4f2ee', fontSize: '0.85rem' }}>
                      <option value="todos">Tudo</option><option value="semana">Semana</option><option value="mes">Mês</option>
                    </select>
                  </div>
                </div>
                
                <div className="card-glass" style={{ overflow: 'hidden' }}>
                  {registrosFiltrados.map((item) => (
                    <div key={item._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: item.tipo === 'entrada' ? 'rgba(200,255,77,0.1)' : 'rgba(255,107,91,0.1)', color: item.tipo === 'entrada' ? '#c8ff4d' : '#ff6b5b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                          {item.tipo === 'entrada' ? '↓' : '↑'}
                        </div>
                        <div>
                          <div style={{ color: '#f4f2ee', fontWeight: '500', fontSize: '1rem' }}>{item.produto}</div>
                          <div style={{ color: '#9a97a6', fontSize: '0.8rem', marginTop: '2px' }}>
                            {item.tipo === 'entrada' ? 'Recebido por: ' : 'Retirado por: '} <strong style={{ color: '#f4f2ee' }}>{item.funcionario || 'Não informado'}</strong> | {item.dataAcao ? item.dataAcao.split('-').reverse().join('/') : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <div style={{ fontWeight: '600', fontSize: '1.1rem', color: item.tipo === 'entrada' ? '#c8ff4d' : '#ff6b5b' }}>
                          {item.tipo === 'entrada' ? '+' : '-'}{item.quantidade} <small>{item.unidade}</small>
                        </div>
                        <button onClick={() => excluirRegistro(item)} style={{ background: 'transparent', border: 'none', color: '#ff6b5b', cursor: 'pointer', fontSize: '1.2rem' }} title="Excluir Registro">🗑️</button>
                      </div>
                    </div>
                  ))}
                  {registrosFiltrados.length === 0 && <div style={{ padding: '30px', textAlign: 'center', color: '#9a97a6' }}>Nenhuma movimentação no período.</div>}
                </div>
              </div>
            </>
          )}

          {abaAtiva === 'erros' && (
            <div>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: '400', fontFamily: '"Instrument Serif", serif', marginBottom: '24px' }}>
                Fórum de <span style={{ color: '#c8ff4d', fontStyle: 'italic' }}>Suporte</span>
              </h2>
              
              <div className="card-glass" style={{ padding: '28px', marginBottom: '32px' }}>
                <h3 style={{ margin: '0 0 16px 0', color: '#f4f2ee', fontSize: '1.1rem', fontWeight: '500' }}>Relatar um Problema</h3>
                <form onSubmit={relatarErro} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <textarea value={textoErro} onChange={e => setTextoErro(e.target.value)} placeholder="Descreva o que aconteceu..." rows="4" style={{ padding: '14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#f4f2ee', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.95rem' }}></textarea>
                  <button type="submit" style={{ alignSelf: 'flex-start', padding: '12px 24px', background: '#ff6b5b', color: '#07070a', border: 'none', borderRadius: '12px', fontWeight: '600', cursor: 'pointer' }}>Enviar Chamado</button>
                </form>
              </div>

              <h3 style={{ margin: '0 0 20px 0', color: '#f4f2ee', fontSize: '1.1rem', fontWeight: '500' }}>Chamados e Respostas</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {erros.map(erro => (
                  <div key={erro._id} className="card-glass" style={{ overflow: 'hidden', border: `1px solid ${erro.resolvido ? 'rgba(200,255,77,0.3)' : 'rgba(255,179,91,0.3)'}` }}>
                    <div style={{ padding: '24px', background: erro.resolvido ? 'rgba(200,255,77,0.03)' : 'rgba(255,179,91,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontWeight: '500', color: '#f4f2ee' }}>Relatado:</span>
                        <span style={{ fontSize: '0.75rem', color: erro.resolvido ? '#c8ff4d' : '#ffb35b', padding: '4px 10px', borderRadius: '20px', border: '1px solid currentColor', fontWeight: '600' }}>{erro.resolvido ? '🟢 Resolvido' : '🟡 Pendente'}</span>
                      </div>
                      <p style={{ color: '#9a97a6', margin: 0, fontSize: '0.95rem' }}>"{erro.descricao}"</p>
                    </div>
                    <div style={{ padding: '24px' }}>
                      {erro.resolvido ? (
                        <div>
                          <strong style={{ color: '#c8ff4d', display: 'block', marginBottom: '6px' }}>RL Soluções de TI:</strong>
                          <p style={{ color: '#f4f2ee', margin: 0, fontSize: '0.95rem' }}>{erro.resposta}</p>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '12px' }}>
                          <input type="text" placeholder="Resposta da RL Soluções de TI..." value={respostas[erro._id] || ''} onChange={(e) => setRespostas({ ...respostas, [erro._id]: e.target.value })} style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#f4f2ee' }} />
                          <button onClick={() => responderErro(erro)} style={{ padding: '10px 20px', background: '#c8ff4d', color: '#07070a', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>Resolver</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {erros.length === 0 && <p style={{ color: '#9a97a6' }}>Nenhum erro relatado.</p>}
              </div>
            </div>
          )}
        </div>

        {/* FOOTER ASSINATURA */}
        <footer style={{ padding: '24px', textAlign: 'center', background: '#0d0d13', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 'auto', width: '100%' }}>
          <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: '1.8rem', color: '#9a97a6', letterSpacing: '0.05em', userSelect: 'none' }}>
            RL Soluções de TI
          </span>
        </footer>
      </main>

      <ToastContainer position="bottom-right" autoClose={2500} theme="dark" />
    </div>
  );
}

export default App;