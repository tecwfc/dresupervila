// ==================== CONFIGURAÇÃO ====================
const API_URL = "https://script.google.com/macros/s/AKfycby1Zykj4_wqdL6LdLZhSLMtlm2YUZmcW8XIMUhiatDwQeycYv8iKROrLJsXbyrPRXSk-A/exec";

let usuarioLogado = null;
let chartPizza = null;
let chartBarras = null;
let chartDRE = null;
let dadosCache = { lista: [], saldoPrevio: 0 };
let historicoDescricoes = JSON.parse(localStorage.getItem('historicoDescricoes') || '[]');

const CLASSIFICACOES_DRE = {
  receita: { nome: 'Receita', icone: '💰', cor: '#10b981' },
  deducao: { nome: 'Deduções', icone: '📉', cor: '#f59e0b' },
  custo: { nome: 'Custos/CMV', icone: '🏭', cor: '#ef4444' },
  despesa: { nome: 'Despesas', icone: '💸', cor: '#8b5cf6' },
  outro: { nome: 'Outros', icone: '📦', cor: '#64748b' }
};

// ==================== FUNÇÕES AUXILIARES ====================
function fmt(v) {
  const num = parseFloat(v) || 0;
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(v) {
  const num = parseFloat(v) || 0;
  return num.toFixed(2).replace('.', ',');
}

function parseDate(raw) {
  if (!raw) return null;
  try {
    if (String(raw).includes("/") && String(raw).includes(":")) {
      const [datePart, timePart] = String(raw).split(" ");
      const [day, month, year] = datePart.split("/");
      const [hour, minute] = timePart.split(":");
      return new Date(year, month - 1, day, hour || 0, minute || 0);
    }
    
    if (typeof raw === 'number' || (!isNaN(raw) && !raw.includes('/') && !raw.includes('-'))) {
      const excelSerial = parseFloat(raw);
      const excelTimestamp = (excelSerial - 25569) * 86400000;
      const date = new Date(excelTimestamp);
      if (excelSerial >= 60) date.setTime(date.getTime() - 86400000);
      return date;
    }
    if (String(raw).includes("T")) return new Date(raw);
    if (String(raw).includes("/")) {
      const parts = String(raw).split("/");
      if (parts.length === 3 && parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
      }
    }
    if (String(raw).includes("-")) {
      const parts = String(raw).split("-");
      if (parts.length === 3) return new Date(parts[0], parts[1] - 1, parts[2]);
    }
  } catch (e) {}
  try { const date = new Date(raw); if (!isNaN(date.getTime())) return date; } catch (e) {}
  return null;
}

function fmtDateBR(raw) {
  try {
    const d = parseDate(raw);
    if (!d || isNaN(d.getTime())) return String(raw);
    
    const horas = d.getHours();
    const minutos = d.getMinutes();
    
    if (horas > 0 || minutos > 0) {
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(horas).padStart(2,'0')}:${String(minutos).padStart(2,'0')}`;
    }
    
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  } catch (e) { 
    return String(raw); 
  }
}

function toInputDate(raw) {
  try {
    const d = parseDate(raw);
    if (!d || isNaN(d.getTime())) return '';
    
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    
    return `${ano}-${mes}-${dia}`;
  } catch (e) { 
    return ''; 
  }
}

function toggleSenha(id, btn) {
  const inp = document.getElementById(id);
  inp.type = inp.type === "password" ? "text" : "password";
  btn.textContent = inp.type === "text" ? "🙈" : "👁️";
}

function updateSelectColor(selectElement) {
  if (!selectElement) return;
  if (selectElement.value === "recebido") {
    selectElement.style.borderColor = "#10b981";
    selectElement.style.color = "#10b981";
  } else if (selectElement.value === "pago") {
    selectElement.style.borderColor = "#ef4444";
    selectElement.style.color = "#ef4444";
  }
}

function mostrarNotificacao(mensagem, tipo = 'info') {
  Swal.fire({
    text: mensagem,
    icon: tipo,
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
  });
}

function atualizarDataAtual() {
  const hoje = new Date();
  document.getElementById('currentDate').textContent = hoje.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ==================== FUNÇÕES DE API ====================
async function chamarAPI(params) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random());
    const script = document.createElement('script');
    const urlParams = new URLSearchParams(params);
    urlParams.append('callback', callbackName);
    const url = API_URL + '?' + urlParams.toString();
    
    window[callbackName] = function(data) {
      delete window[callbackName];
      document.body.removeChild(script);
      resolve(data);
    };
    
    script.onerror = function() {
      delete window[callbackName];
      document.body.removeChild(script);
      reject({ status: 'erro', mensagem: 'Falha na comunicação' });
    };
    
    script.src = url;
    document.body.appendChild(script);
    
    setTimeout(() => {
      if (window[callbackName]) {
        delete window[callbackName];
        document.body.removeChild(script);
        reject({ status: 'erro', mensagem: 'Timeout' });
      }
    }, 8000);
  });
}

// ==================== LOGIN ====================
async function verificarLogin() {
  const empresa = document.getElementById('inputEmpresa').value;
  const usuario = document.getElementById('inputUsuario').value.toLowerCase().trim();
  const senha = document.getElementById('inputSenha').value;
  const msgErro = document.getElementById('msgErro');
  const form = document.getElementById('loginForm');

  msgErro.classList.remove('show');

  if (!usuario || !senha || !empresa) {
    msgErro.innerText = '❌ Preencha todos os campos!';
    msgErro.classList.add('show');
    return;
  }

  form.style.pointerEvents = 'none';
  form.classList.add('hidden');
  document.getElementById('carregando').classList.add('show');

  try {
    const resultado = await chamarAPI({
      action: 'login',
      usuario: empresa,
      senha: senha
    });

    if (resultado && resultado.sucesso) {
      usuarioLogado = {
        usuario: empresa,
        senha: senha,
        nome: resultado.nome || empresa,
        empresaId: empresa
      };
      localStorage.setItem('supervilaSessao', JSON.stringify(usuarioLogado));
      entrarNoApp();
    } else {
      document.getElementById('carregando').classList.remove('show');
      form.classList.remove('hidden');
      form.style.pointerEvents = '';
      msgErro.innerText = '❌ Usuário ou senha inválidos!';
      msgErro.classList.add('show');
      document.getElementById('inputSenha').value = '';
      document.getElementById('inputSenha').focus();
    }
  } catch (error) {
    document.getElementById('carregando').classList.remove('show');
    form.classList.remove('hidden');
    form.style.pointerEvents = '';
    msgErro.innerText = '❌ Erro de conexão!';
    msgErro.classList.add('show');
  }
}

function onEmpresaChange() {
  const empresaSelect = document.getElementById('inputEmpresa');
  const usuarioInput = document.getElementById('inputUsuario');
  if (empresaSelect.value) {
    usuarioInput.value = empresaSelect.value;
    usuarioInput.readOnly = true;
    usuarioInput.style.background = '#f8fafc';
    document.getElementById('inputSenha').focus();
  } else {
    usuarioInput.readOnly = false;
    usuarioInput.style.background = '';
    usuarioInput.value = '';
  }
}

// ==================== FUNÇÃO entrarNoApp MODIFICADA ====================

async function entrarNoApp() {
  // Esconder login e mostrar app
  document.getElementById('telaLogin').classList.add('hidden');
  document.getElementById('app').classList.add('show');
  
  const nomeEmpresa = usuarioLogado.nome || usuarioLogado.usuario;
  
  // Atualizar elementos da interface
  document.getElementById('txtUnidade').innerText = nomeEmpresa;
  document.getElementById('topUnidade').innerText = nomeEmpresa;
  document.getElementById('sideUnidade').innerText = nomeEmpresa;
  document.getElementById('sideUsuario').innerText = usuarioLogado.usuario.charAt(0).toUpperCase();
  document.getElementById('sideUsuarioNome').innerText = nomeEmpresa.split(' ')[0];
  document.getElementById('nomeOperador').innerText = nomeEmpresa.split(' ')[0];

  atualizarDataAtual();
  configurarAtalhosLancamento();
  popularFiltrosDRE();
  popularFiltroMesAno();

  // Mostrar loading enquanto carrega dados
  Swal.fire({
    title: 'Carregando dados...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    // Carregar dados de forma assíncrona
    await carregarDescricoesSelect();
    await carregarListaDescricoes();
    await carregarConfiguracoes();
    await atualizarTabela(); // <-- AGUARDAR conclusão
    await calcularDRE();     // <-- Calcular DRE após dados carregados
    
    Swal.close();
  } catch (error) {
    Swal.close();
    console.error('Erro ao carregar dados:', error);
    mostrarNotificacao('⚠️ Erro ao carregar dados', 'error');
  }
}


// ==================== FUNÇÃO fazerLogout MODIFICADA ====================
function fazerLogout() {
  Swal.fire({
    title: 'Sair?',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#e31d1a',
    confirmButtonText: 'Sim',
    cancelButtonText: 'Não'
  }).then((result) => {
    if (result.isConfirmed) {
      // Limpar sessão e recarregar
      localStorage.removeItem("supervilaSessao");
      usuarioLogado = null;
      
      // Esconder app e mostrar login
      document.getElementById('app').classList.remove('show');
      document.getElementById('telaLogin').classList.remove('hidden');
      
      // Limpar campos de login
      document.getElementById('inputEmpresa').value = '';
      document.getElementById('inputUsuario').value = '';
      document.getElementById('inputSenha').value = '';
      document.getElementById('inputUsuario').readOnly = false;
      document.getElementById('inputUsuario').style.background = '';
    }
  });
}

// ==================== VERIFICAR SESSÃO SALVA (CORRIGIDO) ====================
function verificarSessaoSalva() {
  const s = localStorage.getItem("supervilaSessao");
  if (!s) return false;
  
  try {
    const d = JSON.parse(s);
    // Verificar se os dados são válidos
    if (d.usuario && d.senha && d.nome) {
      usuarioLogado = d;
      return true;
    }
  } catch (e) {
    console.error('Erro ao recuperar sessão:', e);
  }
  return false;
}

// ==================== INICIALIZAÇÃO (CORRIGIDA) ====================
window.addEventListener("DOMContentLoaded", () => {
  // Configurar data atual
  const dataInput = document.getElementById("data");
  if (dataInput) {
    dataInput.value = new Date().toISOString().split('T')[0];
  }
  
  // Popular filtros
  popularFiltroMesAno();
  popularFiltrosDRE();
  
  // Verificar se há sessão salva
  const temSessao = verificarSessaoSalva();
  
  if (temSessao && usuarioLogado) {
    // Se tiver sessão, entrar direto no app
    setTimeout(() => {
      entrarNoApp();
    }, 100);
  } else {
    // Se não tiver sessão, garantir que a tela de login está visível
    document.getElementById('telaLogin').classList.remove('hidden');
    document.getElementById('app').classList.remove('show');
  }
  
  // Configurar selects de cor
  ["tipoOperacao", "editTipo"].forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      updateSelectColor(select);
      select.addEventListener("change", function() { updateSelectColor(this); });
    }
  });
  
  // Configurar listeners do DRE
  ["drePeriodoTipo", "dreMes", "dreAno", "dreInicio", "dreFim"].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => calcularDRE());
  });
});

// ==================== EXCLUSÃO DE LANÇAMENTO INDIVIDUAL ====================
async function excluirLancamento(id, descricao) {
  if (!usuarioLogado) {
    mostrarNotificacao('❌ Não logado', 'error');
    return;
  }

  const result = await Swal.fire({
    title: 'Excluir lançamento?',
    html: `<p>Deseja realmente excluir:</p><strong>${descricao}</strong>`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'Sim, excluir',
    cancelButtonText: 'Cancelar'
  });

  if (!result.isConfirmed) return;

  Swal.fire({
    title: 'Excluindo...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const resultado = await chamarAPI({
      action: "excluir",
      usuario: usuarioLogado.usuario,
      senha: usuarioLogado.senha,
      id: id
    });

    Swal.close();

    if (resultado && resultado.status === "ok") {
      mostrarNotificacao('✅ Lançamento excluído!', 'success');
      await atualizarTabela();
      await calcularDRE();
    } else {
      mostrarNotificacao('❌ Erro ao excluir', 'error');
    }
  } catch (error) {
    Swal.close();
    mostrarNotificacao('❌ Erro de conexão', 'error');
  }
}

// ==================== EXCLUSÃO DE TODOS LANÇAMENTOS COM SENHA ====================
async function excluirTodosLancamentos() {
  if (!usuarioLogado || dadosCache.lista.length === 0) {
    mostrarNotificacao('📭 Nenhum lançamento', 'info');
    return;
  }

  const { value: senha } = await Swal.fire({
    title: '🔒 Confirmação de Segurança',
    text: 'Digite sua senha para excluir TODOS os lançamentos:',
    input: 'password',
    inputPlaceholder: 'Sua senha',
    inputAttributes: {
      autocapitalize: 'off',
      autocorrect: 'off'
    },
    showCancelButton: true,
    confirmButtonText: 'Verificar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#e31d1a',
    inputValidator: (value) => {
      if (!value) {
        return 'Senha obrigatória!';
      }
    }
  });

  if (!senha) return;

  if (senha !== usuarioLogado.senha) {
    Swal.fire({
      icon: 'error',
      title: 'Senha incorreta!',
      text: 'A senha digitada não confere.',
      confirmButtonColor: '#e31d1a'
    });
    return;
  }

  const result = await Swal.fire({
    title: '⚠️ ATENÇÃO! ⚠️',
    html: `
      <div style="text-align: center;">
        <p style="font-size: 18px; margin-bottom: 10px;">Excluir TODOS os lançamentos?</p>
        <p style="font-size: 14px; color: #ef4444; font-weight: bold;">
          ${dadosCache.lista.length} lançamentos serão permanentemente removidos!
        </p>
        <p style="font-size: 12px; color: #64748b; margin-top: 10px;">
          Esta ação não pode ser desfeita.
        </p>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: '✅ SIM, EXCLUIR TUDO',
    cancelButtonText: '❌ NÃO, CANCELAR',
    reverseButtons: true
  });

  if (!result.isConfirmed) return;

  Swal.fire({
    title: 'Excluindo lançamentos...',
    html: `Processando ${dadosCache.lista.length} registros`,
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  let sucessos = 0;
  let erros = 0;

  for (const item of dadosCache.lista) {
    try {
      const resultado = await chamarAPI({
        action: "excluir",
        usuario: usuarioLogado.usuario,
        senha: usuarioLogado.senha,
        id: item[0]
      });
      if (resultado && resultado.status === "ok") sucessos++;
      else erros++;
    } catch (error) {
      erros++;
    }
  }

  Swal.close();
  
  if (sucessos > 0) {
    Swal.fire({
      icon: 'success',
      title: '✅ Exclusão concluída!',
      html: `
        <p><strong>${sucessos}</strong> lançamentos excluídos com sucesso.</p>
        ${erros > 0 ? `<p style="color: #ef4444;">${erros} falhas</p>` : ''}
      `,
      confirmButtonColor: '#10b981'
    });
    await atualizarTabela();
    await calcularDRE();
  } else {
    Swal.fire({
      icon: 'error',
      title: '❌ Erro na exclusão',
      text: 'Nenhum lançamento foi excluído.',
      confirmButtonColor: '#e31d1a'
    });
  }
}

// ==================== ATUALIZAR TABELA DADOS ====================
async function atualizarTabela() {
  if (!usuarioLogado) return;
  
  try {
    const resultado = await chamarAPI({
      action: 'ler',
      usuario: usuarioLogado.usuario,
      senha: usuarioLogado.senha
    });

    if (resultado && resultado.lista !== undefined) {
      dadosCache.lista = resultado.lista || [];
      dadosCache.saldoPrevio = parseFloat(resultado.saldoPrevio) || 0;

      atualizarCards();
      renderCards(dadosCache.lista, dadosCache.saldoPrevio);
      await calcularDRE(); // <-- Aguardar cálculo da DRE
      
      console.log('Dados carregados:', dadosCache.lista.length, 'lançamentos');
      return true;
    } else {
      console.error('Resposta da API sem lista:', resultado);
      return false;
    }
  } catch (error) {
    console.error('Erro ao carregar dados:', error);
    throw error; // Propagar erro para o entrarNoApp capturar
  }
}

// ==================== ATUALIZAR CARDS ====================
function atualizarCards() {
  let tRec = 0, tPag = 0;
  dadosCache.lista.forEach((i) => {
    const recebido = parseFloat(String(i[3]).replace(",", ".")) || 0;
    const pago = parseFloat(String(i[4]).replace(",", ".")) || 0;
    tRec += recebido;
    tPag += pago;
  });

  const mov = tRec - tPag;

  document.getElementById("cardReceitas").innerText = fmt(tRec);
  document.getElementById("cardPago").innerText = fmt(tPag);
  document.getElementById("cardFluxo").innerText = fmt(mov);
  document.getElementById("cardPrevio").innerText = fmt(dadosCache.saldoPrevio);
  document.getElementById("cardSaldo").innerText = fmt(dadosCache.saldoPrevio + mov);
  document.getElementById("bannerPrevio").innerText = fmt(dadosCache.saldoPrevio);
  
  const inputSaldo = document.getElementById("inputSaldoPrevio");
  if (inputSaldo) inputSaldo.value = dadosCache.saldoPrevio.toFixed(2);

  renderGraficos(tRec, tPag);
}

// ==================== LANÇAMENTO COM HORA ====================
async function lancar() {
  if (!usuarioLogado) {
    mostrarNotificacao('❌ Não logado', 'error');
    return;
  }

  const tipo = document.getElementById("tipoOperacao").value;
  let valor = document.getElementById("valor").value;
  const dataInput = document.getElementById("data").value;
  const tipoDRE = document.getElementById("tipoDRE").value;

  const selectDesc = document.getElementById("desc");
  const manualDesc = document.getElementById("descManual");
  let desc = selectDesc.value;

  if (desc === "manual") {
    desc = manualDesc.value.trim();
  }

  if (!desc || !valor || !dataInput) {
    mostrarNotificacao('❌ Preencha todos', 'error');
    return;
  }

  valor = valor.replace(",", ".");
  const valorNum = parseFloat(valor) || 0;

  if (valorNum <= 0) {
    mostrarNotificacao('❌ Valor inválido', 'error');
    return;
  }

  const btn = document.getElementById("btnLancar");
  
  // Salvar estado original
  const originalHTML = btn.innerHTML;
  const originalDisabled = btn.disabled;
  
  // Aplicar animação de salvando
  btn.classList.add('salvando');
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 6v6l4 2"/>
    </svg>
    <span class="btn-text">Salvando...</span>
  `;
  btn.disabled = true;

  const agora = new Date();
  const hora = String(agora.getHours()).padStart(2, '0');
  const minutos = String(agora.getMinutes()).padStart(2, '0');
  const horaFormatada = `${hora}:${minutos}`;
  
  const p = dataInput.split("-");
  const dataFmt = `${p[2]}/${p[1]}/${p[0]} ${horaFormatada}`;

  try {
    const resultado = await chamarAPI({
      action: "lancar",
      usuario: usuarioLogado.usuario,
      senha: usuarioLogado.senha,
      desc: desc,
      data: dataFmt,
      recebido: tipo === "recebido" ? valorNum : 0,
      pago: tipo === "pago" ? valorNum : 0,
      dreClass: tipoDRE
    });

    if (resultado && resultado.status === "sucesso") {
      // Animação de sucesso
      btn.classList.remove('salvando');
      btn.classList.add('salvo');
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span class="btn-text">Salvo!</span>
      `;
      
      // Mostrar toast de sucesso
      mostrarToastPersonalizado({
        titulo: 'Sucesso!',
        mensagem: 'Lançamento salvo com sucesso',
        tipo: 'success'
      });
      
      // Destacar o novo lançamento na lista
      setTimeout(() => {
        const ultimoCard = document.querySelector('.entry-card');
        if (ultimoCard) {
          ultimoCard.classList.add('saved');
          setTimeout(() => ultimoCard.classList.remove('saved'), 1000);
        }
      }, 300);
      
      limparCamposLancamento();
      await atualizarTabela();
      
      // Restaurar botão após 1.5 segundos
      setTimeout(() => {
        btn.classList.remove('salvo');
        btn.innerHTML = originalHTML;
        btn.disabled = false;
      }, 1500);
      
    } else {
      throw new Error('Erro ao salvar');
    }
  } catch (error) {
    // Animação de erro
    btn.classList.remove('salvando');
    btn.classList.add('erro');
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
      <span class="btn-text">Erro!</span>
    `;
    
    mostrarToastPersonalizado({
      titulo: 'Erro!',
      mensagem: error.message || 'Erro ao salvar lançamento',
      tipo: 'error'
    });
    
    setTimeout(() => {
      btn.classList.remove('erro');
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    }, 2000);
  }
}

function limparCamposLancamento() {
  document.getElementById("desc").value = "";
  document.getElementById("descManual").value = "";
  document.getElementById("descManual").style.display = "none";
  document.getElementById("tipoDRE").value = "receita";
  document.getElementById("tipoOperacao").value = "recebido";
  document.getElementById("valor").value = "";
  document.getElementById("data").value = new Date().toISOString().split("T")[0];
}

// ==================== DESCRIÇÕES ====================
async function carregarDescricoesSelect() {
  try {
    const resultado = await chamarAPI({ action: 'buscarDescricoes' });

    const select = document.getElementById('desc');
    if (!select) return;
    
    select.innerHTML = '<option value="">Selecione...</option>';

    if (resultado.status === 'ok' && resultado.descricoes) {
      resultado.descricoes.forEach(item => {
        const option = document.createElement('option');
        option.value = item.descricao;
        option.textContent = item.descricao;
        if (item.classificacao) option.setAttribute('data-class', item.classificacao);
        select.appendChild(option);
      });
    }

    const manualOption = document.createElement('option');
    manualOption.value = "manual";
    manualOption.textContent = "✏️ Digitar...";
    select.appendChild(manualOption);
    
  } catch (error) {}
}

function preencherDescricao(valor) {
  const descManual = document.getElementById('descManual');
  const tipoSelect = document.getElementById('tipoOperacao');
  const dreSelect = document.getElementById('tipoDRE');
  
  if (valor === "manual") {
    descManual.style.display = 'block';
    descManual.focus();
  } else if (valor) {
    const select = document.getElementById('desc');
    const selectedOption = Array.from(select.options).find(opt => opt.value === valor);
    
    if (selectedOption && selectedOption.dataset.class) {
      dreSelect.value = selectedOption.dataset.class;
      tipoSelect.value = selectedOption.dataset.class === 'receita' ? 'recebido' : 'pago';
      updateSelectColor(tipoSelect);
    }
    
    descManual.style.display = 'none';
    descManual.value = '';
  } else {
    descManual.style.display = 'none';
  }
}

// ==================== CADASTRAR DESCRIÇÃO COM ANIMAÇÃO DA LUPA ====================
async function cadastrarDescricao() {
  const descricao = document.getElementById("novaDescricao").value.trim();
  const classificacao = document.getElementById("classificacaoDescricao").value;
  const btnAdd = document.querySelector('.btn-add');

  if (!descricao) {
    mostrarNotificacao('❌ Digite uma descrição', 'error');
    
    btnAdd.style.background = 'var(--danger)';
    setTimeout(() => {
      btnAdd.style.background = 'var(--primary)';
    }, 300);
    return;
  }

  btnAdd.classList.add('cadastrando');
  btnAdd.innerHTML = '⏳';

  try {
    const resultado = await chamarAPI({
      action: "cadastrarDescricao",
      descricao: descricao,
      classificacao: classificacao || null
    });

    if (resultado.status === "ok") {
      mostrarAnimacaoLupa();
      
      btnAdd.style.background = 'var(--success)';
      btnAdd.innerHTML = '✓';
      
      document.getElementById("novaDescricao").value = "";
      document.getElementById("classificacaoDescricao").value = "";
      
      // Atualizar listas com destaque para a nova descrição
      await carregarDescricoesSelect();
      await carregarListaDescricoes(descricao); // Passar a descrição para destacar
      
      mostrarTooltipSucesso(btnAdd, 'Descrição cadastrada!');
      
      setTimeout(() => {
        btnAdd.classList.remove('cadastrando');
        btnAdd.style.background = 'var(--primary)';
        btnAdd.innerHTML = '+';
      }, 1000);
      
    } else {
      throw new Error('Erro no cadastro');
    }
  } catch (error) {
    mostrarNotificacao('❌ Erro ao cadastrar', 'error');
    
    btnAdd.style.background = 'var(--danger)';
    btnAdd.innerHTML = '✕';
    
    setTimeout(() => {
      btnAdd.classList.remove('cadastrando');
      btnAdd.style.background = 'var(--primary)';
      btnAdd.innerHTML = '+';
    }, 1000);
  }
}

// ==================== FUNÇÃO PARA MOSTRAR ANIMAÇÃO DA LUPA ====================
function mostrarAnimacaoLupa() {
  // Criar elemento da lupa
  const lupa = document.createElement('div');
  lupa.className = 'lupa-animation';
  lupa.innerHTML = '🔍';
  lupa.style.position = 'fixed';
  lupa.style.top = '50%';
  lupa.style.left = '50%';
  lupa.style.transform = 'translate(-50%, -50%)';
  lupa.style.background = 'var(--primary)';
  lupa.style.color = 'white';
  lupa.style.width = '100px';
  lupa.style.height = '100px';
  lupa.style.borderRadius = '50%';
  lupa.style.display = 'flex';
  lupa.style.alignItems = 'center';
  lupa.style.justifyContent = 'center';
  lupa.style.fontSize = '50px';
  lupa.style.zIndex = '9999';
  lupa.style.animation = 'searchPulse 0.8s ease-in-out';
  lupa.style.boxShadow = '0 4px 20px rgba(227, 29, 26, 0.5)';
  lupa.style.pointerEvents = 'none';
  
  document.body.appendChild(lupa);
  
  // Remover após animação
  setTimeout(() => {
    lupa.remove();
  }, 800);
}

// ==================== FUNÇÃO PARA MOSTRAR TOOLTIP DE SUCESSO ====================
function mostrarTooltipSucesso(elemento, mensagem) {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip-sucesso';
  tooltip.textContent = mensagem;
  
  // Posicionar relativo ao elemento
  const rect = elemento.getBoundingClientRect();
  tooltip.style.position = 'absolute';
  tooltip.style.top = (rect.top - 40) + 'px';
  tooltip.style.right = (window.innerWidth - rect.right) + 'px';
  
  document.body.appendChild(tooltip);
  
  setTimeout(() => {
    tooltip.remove();
  }, 1500);
}

// ==================== CONFIGURAÇÕES ====================
async function carregarConfiguracoes() {
  if (!usuarioLogado) return;
  try {
    const resultado = await chamarAPI({
      action: "ler",
      usuario: usuarioLogado.usuario,
      senha: usuarioLogado.senha
    });
    
    if (resultado && resultado.saldoPrevio !== undefined) {
      const saldoPrevio = parseFloat(resultado.saldoPrevio) || 0;
      const inputSaldo = document.getElementById("inputSaldoPrevio");
      if (inputSaldo) inputSaldo.value = saldoPrevio.toFixed(2);
    }
  } catch (e) {}
}

async function salvarConfiguracoes() {
  if (!usuarioLogado) return;
  
  let saldo = document.getElementById("inputSaldoPrevio")?.value;
  const senha = document.getElementById("senhaConfirmacao")?.value;
  
  const msgErro = document.getElementById("msgErroConfig");
  const msgSucesso = document.getElementById("msgSucessoConfig");
  
  if (msgErro) msgErro.style.display = "none";
  if (msgSucesso) msgSucesso.style.display = "none";

  if (!saldo || !senha) {
    if (msgErro) { 
      msgErro.innerText = '❌ Preencha todos!'; 
      msgErro.style.display = 'block'; 
    }
    return;
  }

  if (senha !== usuarioLogado.senha) {
    if (msgErro) { 
      msgErro.innerText = '❌ Senha incorreta!'; 
      msgErro.style.display = 'block'; 
    }
    return;
  }

  saldo = saldo.replace(",", ".");
  const novoSaldo = parseFloat(saldo);

  if (isNaN(novoSaldo)) {
    if (msgErro) { 
      msgErro.innerText = '❌ Valor inválido!'; 
      msgErro.style.display = 'block'; 
    }
    return;
  }

  try {
    const resultado = await chamarAPI({
      action: "salvarConfig",
      usuario: usuarioLogado.usuario,
      senha: usuarioLogado.senha,
      salario: novoSaldo
    });

    if (resultado && resultado.status === "ok") {
      document.getElementById("senhaConfirmacao").value = "";
      
      if (msgSucesso) {
        msgSucesso.style.display = 'block';
        setTimeout(() => msgSucesso.style.display = 'none', 2000);
      }
      
      await atualizarTabela();
    } else {
      if (msgErro) {
        msgErro.innerText = '❌ Erro ao atualizar';
        msgErro.style.display = 'block';
      }
    }
  } catch (error) {
    if (msgErro) {
      msgErro.innerText = '❌ Erro de conexão';
      msgErro.style.display = 'block';
    }
  }
}

// ==================== CARREGAR LISTA DE DESCRIÇÕES PARA CONFIGURAÇÃO ====================

async function carregarListaDescricoes(destacarDescricao = null) {
  const container = document.getElementById('listaDescricoes');
  if (!container) return;
  
  try {
    const resultado = await chamarAPI({ action: 'buscarDescricoes' });
    
    if (resultado.status === 'ok' && resultado.descricoes) {
      const descricoes = resultado.descricoes;
      
      // Atualizar contador
      document.getElementById('contadorDescricoes').textContent = descricoes.length;
      
      if (descricoes.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">Nenhuma descrição cadastrada</div>';
        return;
      }
      
      // Agrupar por classificação
      const grupos = {
        receita: [],
        deducao: [],
        custo: [],
        despesa: [],
        outro: []
      };
      
      descricoes.forEach(item => {
        const classificacao = item.classificacao || 'outro';
        if (grupos[classificacao]) {
          grupos[classificacao].push(item);
        } else {
          grupos.outro.push(item);
        }
      });
      
      let html = '';
      
      // Função para renderizar grupo
      const renderizarGrupo = (titulo, icone, cor, itens) => {
        if (itens.length === 0) return '';
        
        return `
          <div class="categoria-card" style="border-left-color: ${cor};">
            <div class="categoria-header" onclick="toggleCategoria('${titulo}')">
              <div class="categoria-titulo">
                <span class="categoria-icone">${icone}</span>
                <span class="categoria-nome">${titulo}</span>
                <span class="categoria-count">${itens.length}</span>
              </div>
              <span class="categoria-toggle" id="toggle-${titulo}">▼</span>
            </div>
            <div class="categoria-itens" id="categoria-${titulo}" style="display: block;">
              ${itens.map(item => {
                const isNovo = destacarDescricao === item.descricao;
                return `
                  <div class="descricao-item-categoria ${isNovo ? 'novo' : ''}">
                    <div class="descricao-info">
                      <div class="descricao-texto">${item.descricao}</div>
                      ${item.classificacao ? `<span class="classificacao-badge" style="background: ${cor}20; color: ${cor};">${icone} ${titulo}</span>` : ''}
                    </div>
                    <button class="btn-remove" onclick="removerDescricao('${item.descricao}')" title="Remover">✕</button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      };
      
      html += renderizarGrupo('Receitas', '💰', '#10b981', grupos.receita);
      html += renderizarGrupo('Deduções', '📉', '#f59e0b', grupos.deducao);
      html += renderizarGrupo('Custos', '🏭', '#ef4444', grupos.custo);
      html += renderizarGrupo('Despesas', '💸', '#8b5cf6', grupos.despesa);
      html += renderizarGrupo('Outros', '📦', '#64748b', grupos.outro);
      
      container.innerHTML = html;
      
      // Se tiver uma descrição para destacar, rolar até ela
      if (destacarDescricao) {
        setTimeout(() => {
          const itens = document.querySelectorAll('.descricao-texto');
          for (let item of itens) {
            if (item.textContent === destacarDescricao) {
              item.scrollIntoView({ behavior: 'smooth', block: 'center' });
              break;
            }
          }
        }, 100);
      }
    }
  } catch (error) {
    console.error('Erro ao carregar descrições:', error);
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">Erro ao carregar descrições</div>';
  }
}

// ==================== FUNÇÃO PARA REMOVER DESCRIÇÃO ====================
// ==================== REMOVER DESCRIÇÃO COM ANIMAÇÃO ====================
async function removerDescricao(descricao) {
  const result = await Swal.fire({
    title: 'Remover descrição?',
    text: `Deseja realmente remover "${descricao}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar',
    showClass: {
      popup: 'animate__animated animate__fadeInDown'
    },
    hideClass: {
      popup: 'animate__animated animate__fadeOutUp'
    }
  });

  if (!result.isConfirmed) return;

  // Encontrar o elemento da descrição
  const itens = document.querySelectorAll('.descricao-item-categoria');
  let elementoRemover = null;
  
  itens.forEach(item => {
    const texto = item.querySelector('.descricao-texto')?.textContent;
    if (texto === descricao) {
      elementoRemover = item;
    }
  });

  // Aplicar animação de remoção
  if (elementoRemover) {
    elementoRemover.classList.add('removendo');
  }

  try {
    const resultado = await chamarAPI({
      action: 'removerDescricao',
      descricao: descricao
    });

    if (resultado.status === 'ok') {
      // Mostrar notificação de sucesso
      mostrarNotificacao('✅ Descrição removida!', 'success');
      
      // Aguardar animação e atualizar
      setTimeout(async () => {
        await carregarListaDescricoes();
        await carregarDescricoesSelect();
      }, 300);
      
    } else {
      // Remover classe de animação se falhou
      if (elementoRemover) {
        elementoRemover.classList.remove('removendo');
      }
      mostrarNotificacao('❌ Erro ao remover', 'error');
    }
  } catch (error) {
    // Remover classe de animação se falhou
    if (elementoRemover) {
      elementoRemover.classList.remove('removendo');
    }
    mostrarNotificacao('❌ Erro de conexão', 'error');
  }
}

// ==================== FUNÇÃO PARA ALTERNAR CATEGORIA ====================
function toggleCategoria(categoria) {
  const elemento = document.getElementById(`categoria-${categoria}`);
  const toggle = document.getElementById(`toggle-${categoria}`);
  
  if (elemento) {
    if (elemento.style.display === 'none') {
      elemento.style.display = 'block';
      if (toggle) toggle.textContent = '▼';
    } else {
      elemento.style.display = 'none';
      if (toggle) toggle.textContent = '▶';
    }
  }
}
// ==================== MODAL ====================
function abrirModal(id, data, desc, rec, pag, dreClass = 'outro') {
  document.getElementById("editId").value = id;
  document.getElementById("editData").value = toInputDate(data);
  document.getElementById("editTipo").value = rec > 0 ? "recebido" : "pago";
  document.getElementById("editValor").value = rec > 0 ? rec : pag;
  document.getElementById("editTipoDRE").value = dreClass;
  updateSelectColor(document.getElementById("editTipo"));
  document.getElementById("modalEditar").classList.add("show");
  
  setTimeout(async () => {
    const descSelect = document.getElementById('editDesc');
    descSelect.innerHTML = '<option value="">Selecione...</option>';
    
    try {
      const resultado = await chamarAPI({ action: 'buscarDescricoes' });
      if (resultado.status === 'ok' && resultado.descricoes) {
        resultado.descricoes.forEach(item => {
          const option = document.createElement('option');
          option.value = item.descricao;
          option.textContent = item.descricao;
          if (item.classificacao) option.setAttribute('data-class', item.classificacao);
          descSelect.appendChild(option);
        });
      }
      
      const manualOption = document.createElement('option');
      manualOption.value = "manual";
      manualOption.textContent = "✏️ Digitar...";
      descSelect.appendChild(manualOption);
      
      const descricoesExistentes = resultado.descricoes?.map(d => d.descricao) || [];
      
      if (desc && descricoesExistentes.includes(desc)) {
        descSelect.value = desc;
      } else if (desc) {
        descSelect.value = "manual";
        document.getElementById('editDescManual').style.display = 'block';
        document.getElementById('editDescManual').value = desc;
      }
    } catch (e) {}
  }, 0);
}

function fecharModal() {
  document.getElementById("modalEditar").classList.remove("show");
  document.getElementById('editDescManual').style.display = 'none';
  document.getElementById('editDescManual').value = '';
}

// ==================== SALVAR EDIÇÃO COM ANIMAÇÃO ====================
async function salvarEditar() {
  if (!usuarioLogado) {
    fecharModal();
    return;
  }

  const id = document.getElementById("editId").value;
  const dataInput = document.getElementById("editData").value;
  let desc = '';
  const tipo = document.getElementById("editTipo").value;
  let valor = document.getElementById("editValor").value;
  const dreClass = document.getElementById("editTipoDRE").value;

  const descSelect = document.getElementById('editDesc');
  const descManual = document.getElementById('editDescManual');
  
  if (descSelect.value === "manual") {
    desc = descManual ? descManual.value.trim() : '';
  } else {
    desc = descSelect.value.trim();
  }

  if (!dataInput || !desc || !valor) {
    mostrarNotificacao('❌ Preencha todos', 'error');
    return;
  }

  valor = valor.replace(",", ".");
  const valorNum = parseFloat(valor) || 0;

  if (valorNum <= 0) {
    mostrarNotificacao('❌ Valor inválido', 'error');
    return;
  }

  const btnSalvar = document.getElementById("btnSalvarEditar");
  
  // Salvar estado original
  const originalHTML = btnSalvar.innerHTML;
  const originalDisabled = btnSalvar.disabled;
  
  // Aplicar animação
  btnSalvar.classList.add('modal-salvando');
  btnSalvar.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 6v6l4 2"/>
    </svg>
    <span>Salvando...</span>
  `;
  btnSalvar.disabled = true;

  const p = dataInput.split("-");
  const dataFmt = `${p[2]}/${p[1]}/${p[0]}`;

  try {
    const resultado = await chamarAPI({
      action: "editar",
      usuario: usuarioLogado.usuario,
      senha: usuarioLogado.senha,
      id: id,
      data: dataFmt,
      desc: desc,
      recebido: tipo === "recebido" ? valorNum : 0,
      pago: tipo === "pago" ? valorNum : 0,
      dreClass: dreClass
    });

    if (resultado && resultado.status === "ok") {
      // Animação de sucesso
      btnSalvar.classList.remove('modal-salvando');
      btnSalvar.classList.add('modal-salvo');
      btnSalvar.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Salvo!</span>
      `;
      
      mostrarToastPersonalizado({
        titulo: 'Sucesso!',
        mensagem: 'Lançamento atualizado',
        tipo: 'success'
      });
      
      // Fechar modal após breve delay
      setTimeout(() => {
        fecharModal();
        
        // Restaurar botão
        btnSalvar.classList.remove('modal-salvo');
        btnSalvar.innerHTML = originalHTML;
        btnSalvar.disabled = false;
      }, 1000);
      
      await atualizarTabela();
      await calcularDRE();
      
    } else {
      throw new Error('Erro ao editar');
    }
  } catch (error) {
    // Animação de erro
    btnSalvar.classList.remove('modal-salvando');
    btnSalvar.classList.add('erro');
    btnSalvar.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
      <span>Erro!</span>
    `;
    
    mostrarToastPersonalizado({
      titulo: 'Erro!',
      mensagem: 'Erro ao atualizar lançamento',
      tipo: 'error'
    });
    
    setTimeout(() => {
      btnSalvar.classList.remove('erro');
      btnSalvar.innerHTML = originalHTML;
      btnSalvar.disabled = false;
    }, 2000);
  }
}

// ==================== TOAST PERSONALIZADO ====================
function mostrarToastPersonalizado({ titulo, mensagem, tipo = 'info', tempo = 3000 }) {
  const toast = document.createElement('div');
  toast.className = `custom-toast ${tipo}`;
  
  const icones = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  toast.innerHTML = `
    <div class="toast-icon ${tipo}">${icones[tipo]}</div>
    <div class="toast-content">
      <div class="toast-title">${titulo}</div>
      <div class="toast-message">${mensagem}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  document.body.appendChild(toast);
  
  // Auto-remover após o tempo
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideOutRight 0.3s ease forwards';
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 300);
    }
  }, tempo);
}

// ==================== OVERRIDE DA FUNÇÃO mostrarNotificacao ====================
// Manter a original para compatibilidade, mas podemos substituir
const mostrarNotificacaoOriginal = mostrarNotificacao;
mostrarNotificacao = function(mensagem, tipo = 'info') {
  // Usar toast personalizado em vez do Swal
  const titulos = {
    success: 'Sucesso!',
    error: 'Erro!',
    warning: 'Atenção!',
    info: 'Informação'
  };
  
  mostrarToastPersonalizado({
    titulo: titulos[tipo] || 'Informação',
    mensagem: mensagem,
    tipo: tipo
  });
};
// ==================== DRE ====================
function popularFiltrosDRE() {
  const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const selM = document.getElementById("dreMes");
  const selA = document.getElementById("dreAno");
  const hoje = new Date();
  
  if (!selM || !selA) return;
  
  selM.innerHTML = '';
  meses.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = m;
    if (i === hoje.getMonth()) o.selected = true;
    selM.appendChild(o);
  });
  
  selA.innerHTML = '';
  for (let a = hoje.getFullYear(); a >= 2020; a--) {
    const o = document.createElement("option");
    o.value = a;
    o.textContent = a;
    if (a === hoje.getFullYear()) o.selected = true;
    selA.appendChild(o);
  }
  
  const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  
  const inicioInput = document.getElementById("dreInicio");
  const fimInput = document.getElementById("dreFim");
  if (inicioInput) inicioInput.value = primeiroDia.toISOString().split('T')[0];
  if (fimInput) fimInput.value = ultimoDia.toISOString().split('T')[0];
}

function atualizarDrePeriodo() {
  const tipo = document.getElementById("drePeriodoTipo").value;
  const wrapMes = document.getElementById("dreWrapMes");
  const wrapPeriodo = document.getElementById("dreWrapPeriodo");
  
  if (tipo === "mesPersonalizado") {
    wrapMes.style.display = "flex";
    wrapPeriodo.style.display = "none";
  } else if (tipo === "periodo") {
    wrapMes.style.display = "none";
    wrapPeriodo.style.display = "flex";
  } else {
    wrapMes.style.display = "none";
    wrapPeriodo.style.display = "none";
  }
  
  calcularDRE();
}

function obterPeriodoDRE() {
  const tipo = document.getElementById("drePeriodoTipo").value;
  const hoje = new Date();
  let inicio, fim;
  
  switch(tipo) {
    case "mes":
      inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      break;
    case "mesPersonalizado":
      const mes = parseInt(document.getElementById("dreMes").value);
      const ano = parseInt(document.getElementById("dreAno").value);
      inicio = new Date(ano, mes, 1);
      fim = new Date(ano, mes + 1, 0);
      break;
    case "periodo":
      const i = document.getElementById("dreInicio").value;
      const f = document.getElementById("dreFim").value;
      if (!i || !f) return null;
      inicio = new Date(i + "T00:00:00");
      fim = new Date(f + "T23:59:59");
      break;
    case "ano":
      inicio = new Date(hoje.getFullYear(), 0, 1);
      fim = new Date(hoje.getFullYear(), 11, 31);
      break;
    default:
      inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  }
  return { inicio, fim };
}

function calcularDRE() {
  if (!dadosCache.lista || dadosCache.lista.length === 0) {
    atualizarValoresDRE(0, 0, 0, 0, 0, 0, 0);
    return;
  }
  
  const periodo = obterPeriodoDRE();
  if (!periodo) return;
  
  const registrosPeriodo = dadosCache.lista.filter(item => {
    const data = parseDate(item[1]);
    return data && data >= periodo.inicio && data <= periodo.fim;
  });
  
  let receitaBruta = 0, deducoes = 0, custos = 0, despesas = 0;
  
  registrosPeriodo.forEach(item => {
    const valor = parseFloat(String(item[3]).replace(",", ".")) - parseFloat(String(item[4]).replace(",", "."));
    const classificacao = item[5] || 'outro';
    
    if (classificacao === 'receita') receitaBruta += valor;
    else if (classificacao === 'deducao') deducoes += Math.abs(valor);
    else if (classificacao === 'custo') custos += Math.abs(valor);
    else if (classificacao === 'despesa') despesas += Math.abs(valor);
  });
  
  const receitaLiquida = receitaBruta - deducoes;
  const lucroBruto = receitaLiquida - custos;
  const lucroLiquido = lucroBruto - despesas;
  
  atualizarValoresDRE(receitaBruta, deducoes, receitaLiquida, custos, lucroBruto, despesas, lucroLiquido);
  
  const margemBruta = receitaLiquida > 0 ? (lucroBruto / receitaLiquida) * 100 : 0;
  const margemLiquida = receitaLiquida > 0 ? (lucroLiquido / receitaLiquida) * 100 : 0;
  
  document.getElementById("dreMargemBruta").innerText = margemBruta.toFixed(2) + '%';
  document.getElementById("dreMargemLiquida").innerText = margemLiquida.toFixed(2) + '%';
  
  atualizarMargensDRE();
  
  renderGraficoDRE(receitaBruta, deducoes, custos, despesas, lucroLiquido);
  
  renderDetalhamentoDRE(registrosPeriodo, receitaBruta, deducoes, receitaLiquida, custos, lucroBruto, despesas, lucroLiquido, margemBruta, margemLiquida);
}

function atualizarValoresDRE(receitaBruta, deducoes, receitaLiquida, custos, lucroBruto, despesas, lucroLiquido) {
  document.getElementById("dreReceitaBruta").innerText = fmt(receitaBruta);
  document.getElementById("dreDeducoes").innerText = fmt(deducoes);
  document.getElementById("dreReceitaLiquida").innerText = fmt(receitaLiquida);
  document.getElementById("dreCustos").innerText = fmt(custos);
  document.getElementById("dreLucroBruto").innerText = fmt(lucroBruto);
  document.getElementById("dreDespesas").innerText = fmt(despesas);
  document.getElementById("dreLucroLiquido").innerText = fmt(lucroLiquido);
}

function renderGraficoDRE(receitaBruta, deducoes, custos, despesas, lucroLiquido) {
  const ctx = document.getElementById("graficoDRE");
  if (!ctx) return;
  
  if (window.chartDRE) window.chartDRE.destroy();
  
  window.chartDRE = new Chart(ctx.getContext("2d"), {
    type: "bar",
    data: {
      labels: ["Receita", "Deduções", "Custos", "Despesas", "Lucro"],
      datasets: [{
        label: "Valores",
        data: [receitaBruta, -deducoes, -custos, -despesas, lucroLiquido],
        backgroundColor: ["#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#3b82f6"],
        borderRadius: 6,
        barPercentage: 0.7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { 
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return 'R$ ' + context.raw.toFixed(2).replace('.', ',');
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: value => 'R$ ' + value.toFixed(2) },
          grid: { color: '#e5e7eb' }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderDetalhamentoDRE(registros, receitaBruta, deducoes, receitaLiquida, custos, lucroBruto, despesas, lucroLiquido, margemBruta, margemLiquida) {
  const container = document.getElementById("dreDetalhamento");
  
  if (!registros || registros.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Nenhum lançamento no período</p></div>';
    return;
  }

  let html = '<table class="dre-tabela">';
  html += '<tr><th class="descricao">DESCRIÇÃO</th><th class="valor">VALOR</th></tr>';
  
  html += `<tr><td class="descricao"><strong>RECEITA BRUTA</strong></td><td class="valor positivo"><strong>${fmt(receitaBruta)}</strong></td></tr>`;
  
  if (deducoes > 0) {
    html += `<tr><td class="descricao">(-) Deduções</td><td class="valor negativo">${fmt(-deducoes)}</td></tr>`;
  } else {
    html += `<tr><td class="descricao">(-) Deduções</td><td class="valor">R$ 0,00</td></tr>`;
  }
  
  html += `<tr class="total-row"><td class="descricao"><strong>= RECEITA LÍQUIDA</strong></td><td class="valor positivo"><strong>${fmt(receitaLiquida)}</strong></td></tr>`;
  
  if (custos > 0) {
    html += `<tr><td class="descricao">(-) Custos/CMV</td><td class="valor negativo">${fmt(-custos)}</td></tr>`;
  } else {
    html += `<tr><td class="descricao">(-) Custos/CMV</td><td class="valor">R$ 0,00</td></tr>`;
  }
  
  html += `<tr class="total-row"><td class="descricao"><strong>= LUCRO BRUTO</strong></td><td class="valor ${lucroBruto >= 0 ? 'positivo' : 'negativo'}"><strong>${fmt(lucroBruto)}</strong></td></tr>`;
  
  if (despesas > 0) {
    html += `<tr><td class="descricao">(-) Despesas</td><td class="valor negativo">${fmt(-despesas)}</td></tr>`;
  } else {
    html += `<tr><td class="descricao">(-) Despesas</td><td class="valor">R$ 0,00</td></tr>`;
  }
  
  html += `<tr class="total-row"><td class="descricao"><strong>= LUCRO LÍQUIDO</strong></td><td class="valor ${lucroLiquido >= 0 ? 'positivo' : 'negativo'}"><strong>${fmt(lucroLiquido)}</strong></td></tr>`;
  
  html += '</table>';
  
  html += '<div class="dre-resumo">';
  html += `<div class="dre-resumo-item"><span class="dre-resumo-label">Margem Bruta</span><span class="dre-resumo-valor">${margemBruta.toFixed(2)}%</span></div>`;
  html += `<div class="dre-resumo-item"><span class="dre-resumo-label">Margem Líquida</span><span class="dre-resumo-valor">${margemLiquida.toFixed(2)}%</span></div>`;
  html += '</div>';
  
  const periodo = obterPeriodoDRE();
  if (periodo) {
    const dataInicio = periodo.inicio.toLocaleDateString('pt-BR');
    const dataFim = periodo.fim.toLocaleDateString('pt-BR');
    html = `<div class="dre-periodo-info">Período: ${dataInicio} até ${dataFim}</div>` + html;
  }
  
  container.innerHTML = html;
}

function toggleDetalhamento() {
  const content = document.getElementById("dreDetalhamento");
  const icon = document.querySelector('.detalhamento-section .toggle-icon');
  if (content.style.display === 'none' || !content.style.display) {
    content.style.display = 'block';
    icon.style.transform = 'rotate(0deg)';
  } else {
    content.style.display = 'none';
    icon.style.transform = 'rotate(-90deg)';
  }
}

// ==================== RENDERIZAÇÃO ====================
function renderCards(lista, saldoPrevio) {
  const container = document.getElementById("libroCards");
  
  atualizarTotaisLivroCaixa();

  if (lista.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><h3>Nenhum registro</h3><p>Faça um lançamento</p></div>`;
    return;
  }

  let acum = saldoPrevio, html = "";
  const listaOrdenada = [...lista].sort((a, b) => {
    const dateA = parseDate(a[1]) || new Date(0);
    const dateB = parseDate(b[1]) || new Date(0);
    return dateB - dateA;
  });

  listaOrdenada.forEach((item) => {
    const recebido = parseFloat(String(item[3]).replace(",", ".")) || 0;
    const pago = parseFloat(String(item[4]).replace(",", ".")) || 0;
    const classificacao = item[5] || 'outro';
    const isEntrada = recebido > 0;
    const valorExib = isEntrada ? recebido : pago;
    acum += recebido - pago;

    const classInfo = CLASSIFICACOES_DRE[classificacao] || CLASSIFICACOES_DRE.outro;
    const descEsc = item[2].replace(/'/g, "\\'");
    
    const dataObj = parseDate(item[1]);
    const temHora = dataObj && (dataObj.getHours() > 0 || dataObj.getMinutes() > 0);
    const iconeHora = temHora ? '🕐' : '📅';

    html += `
      <div class="entry-card ${isEntrada ? "entrada" : "saida"}">
        <div class="entry-header">
          <div class="entry-title">
            <span class="entry-desc">${item[2]}</span>
            <span class="entry-badge ${isEntrada ? "in" : "out"}">${isEntrada ? "Entrada" : "Saída"}</span>
          </div>
          <div class="entry-dre-badge" style="color: ${classInfo.cor}">
            ${classInfo.icone} ${classInfo.nome}
          </div>
        </div>
        <div class="entry-body">
          <div class="entry-meta">
            <span>${iconeHora} ${fmtDateBR(item[1])}</span>
            <span>•</span>
            <span>Saldo: <strong>${fmt(acum)}</strong></span>
          </div>
          <div class="entry-value ${isEntrada ? "in" : "out"}">
            ${isEntrada ? "+" : "-"} ${fmt(valorExib)}
          </div>
        </div>
        <div class="entry-actions">
          <button class="btn-edit" onclick="abrirModal('${item[0]}','${item[1]}','${descEsc}',${recebido},${pago},'${classificacao}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
            </svg>
            <span>Editar</span>
          </button>
          <button class="btn-del" onclick="excluirLancamento('${item[0]}', '${descEsc}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
            <span>Excluir</span>
          </button>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

function renderGraficos(rec, pag) {
  const ctxP = document.getElementById("graficoPizza");
  const ctxB = document.getElementById("graficoBarras");
  if (!ctxP || !ctxB) return;
  
  if (chartPizza) chartPizza.destroy();
  if (chartBarras) chartBarras.destroy();

  chartPizza = new Chart(ctxP.getContext("2d"), {
    type: "doughnut",
    data: { 
      labels: ["Entradas", "Saídas"], 
      datasets: [{ 
        data: [rec, pag], 
        backgroundColor: ["#10b981", "#ef4444"], 
        borderWidth: 0
      }] 
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: { legend: { display: false } }
    }
  });

  chartBarras = new Chart(ctxB.getContext("2d"), {
    type: "bar",
    data: { 
      labels: ["Entradas", "Saídas"], 
      datasets: [{ 
        data: [rec, pag], 
        backgroundColor: ["#10b981", "#ef4444"],
        borderRadius: 4
      }] 
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }, 
      scales: { 
        y: { 
          beginAtZero: true,
          ticks: { callback: value => 'R$ ' + value.toFixed(2) }
        }
      } 
    }
  });
}

// ==================== FILTROS PDF ====================
function popularFiltroMesAno() {
  const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const selM = document.getElementById("filtroMes");
  const selA = document.getElementById("filtroMesAno");
  const hoje = new Date();
  
  if (!selM || !selA) return;
  
  meses.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = m;
    if (i === hoje.getMonth()) o.selected = true;
    selM.appendChild(o);
  });
  
  for (let a = hoje.getFullYear(); a >= 2020; a--) {
    const o = document.createElement("option");
    o.value = a;
    o.textContent = a;
    if (a === hoje.getFullYear()) o.selected = true;
    selA.appendChild(o);
  }
}

function atualizarFiltroPeriodo() {
  const tipo = document.getElementById("filtroTipo").value;
  const wrapMes = document.getElementById("wrapMes");
  const wrapPeriodo = document.getElementById("wrapPeriodo");
  
  if (tipo === "mes") {
    wrapMes.style.display = "flex";
    wrapPeriodo.style.display = "none";
  } else {
    wrapMes.style.display = "none";
    wrapPeriodo.style.display = "flex";
  }
  
  if (dadosCache.lista.length > 0) {
    renderCards(dadosCache.lista, dadosCache.saldoPrevio);
  }
}

function obterPeriodoFiltro() {
  const tipo = document.getElementById("filtroTipo").value;
  
  if (tipo === "mes") {
    const m = parseInt(document.getElementById("filtroMes").value);
    const a = parseInt(document.getElementById("filtroMesAno").value);
    return { inicio: new Date(a, m, 1), fim: new Date(a, m + 1, 0) };
  }
  
  const i = document.getElementById("filtroPeriodoInicio").value;
  const f = document.getElementById("filtroPeriodoFim").value;
  if (!i || !f) return null;
  return { inicio: new Date(i + "T00:00:00"), fim: new Date(f + "T23:59:59") };
}

// ==================== FUNÇÃO AUXILIAR MOEDA ====================
function formatarMoedaPDF(valor) {
  return 'R$ ' + valor.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ==================== PDF LIVRO CAIXA VISUAL ====================
// ==================== PDF LIVRO CAIXA VISUAL (CORRIGIDO - SEM EMOJIS) ====================
async function gerarPDFLivroCaixa() {
  if (!usuarioLogado) return;
  
  const periodo = obterPeriodoFiltro();
  if (!periodo) {
    Swal.fire('Período inválido!', '', 'warning');
    return;
  }

  const filtrada = dadosCache.lista.filter((item) => {
    const d = parseDate(item[1]);
    return d && d >= periodo.inicio && d <= periodo.fim;
  });

  if (!filtrada.length) {
    Swal.fire('Nenhum registro', '', 'info');
    return;
  }

  filtrada.sort((a, b) => parseDate(a[1]) - parseDate(b[1]));

  let totalRecebido = 0;
  let totalPago = 0;

  filtrada.forEach(i => {
    totalRecebido += parseFloat(String(i[3]).replace(",", ".")) || 0;
    totalPago += parseFloat(String(i[4]).replace(",", ".")) || 0;
  });
  
  const saldoMovimento = totalRecebido - totalPago;
  const saldoFinal = dadosCache.saldoPrevio + saldoMovimento;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // CORES
  const cores = {
    primaria: [227, 29, 26],
    primariaClara: [255, 235, 238],
    secundaria: [30, 41, 59],
    sucesso: [16, 185, 129],
    perigo: [239, 68, 68],
    info: [59, 130, 246],
    warning: [245, 158, 11],
    cinzaClaro: [241, 245, 249],
    cinzaMedio: [203, 213, 225],
    cinzaEscuro: [71, 85, 105],
    branco: [255, 255, 255]
  };

  // CABEÇALHO
  doc.setFillColor(cores.secundaria[0], cores.secundaria[1], cores.secundaria[2]);
  doc.rect(0, 0, 210, 35, 'F');
  doc.setFillColor(cores.primaria[0], cores.primaria[1], cores.primaria[2]);
  doc.rect(0, 0, 8, 35, 'F');
  
  doc.setFillColor(cores.primaria[0], cores.primaria[1], cores.primaria[2]);
  doc.circle(25, 17.5, 8, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DRE', 21, 20);
  
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('LIVRO DE CAIXA', 45, 20);
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(usuarioLogado.nome.toUpperCase(), 45, 28);

  // PERÍODO (sem emoji)
  const formatarData = d => d ? 
    `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '';
  
  const dataInicio = formatarData(periodo.inicio);
  const dataFim = formatarData(periodo.fim);
  
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(20, 45, 170, 18, 3, 3, 'F');
  doc.setDrawColor(cores.cinzaMedio[0], cores.cinzaMedio[1], cores.cinzaMedio[2]);
  doc.setLineWidth(0.3);
  doc.roundedRect(20, 45, 170, 18, 3, 3, 'S');
  
  doc.setFontSize(10);
  doc.setTextColor(cores.secundaria[0], cores.secundaria[1], cores.secundaria[2]);
  doc.setFont('helvetica', 'bold');
  doc.text('PERIODO:', 25, 55); // Sem emoji
  
  doc.setTextColor(cores.cinzaEscuro[0], cores.cinzaEscuro[1], cores.cinzaEscuro[2]);
  doc.setFont('helvetica', 'normal');
  doc.text(`${dataInicio} ate ${dataFim}`, 58, 55); // "ate" sem acento para evitar problemas
  
  doc.setFillColor(cores.primaria[0], cores.primaria[1], cores.primaria[2]);
  doc.circle(22, 54, 2, 'F');

  // TABELA (igual ao anterior)
  const body = [];
  let acum = dadosCache.saldoPrevio;
  
  filtrada.forEach(item => {
    const recebido = parseFloat(String(item[3]).replace(",", ".")) || 0;
    const pago = parseFloat(String(item[4]).replace(",", ".")) || 0;
    acum += recebido - pago;
    const d = parseDate(item[1]);
    
    body.push([
      d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}` : '',
      item[2] || '-',
      recebido > 0 ? formatarMoedaPDF(recebido) : '-',
      pago > 0 ? formatarMoedaPDF(pago) : '-',
      formatarMoedaPDF(acum)
    ]);
  });

  doc.autoTable({
    startY: 70,
    head: [['DATA', 'DESCRICAO', 'RECEBIDO', 'PAGO', 'SALDO']], // Sem acentos
    body: body,
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 5,
      font: 'helvetica',
      lineColor: [220, 220, 220],
      lineWidth: 0.1,
      textColor: [50, 50, 50]
    },
    headStyles: {
      fillColor: cores.primaria,
      textColor: 255,
      fontSize: 10,
      fontStyle: 'bold',
      halign: 'center',
      lineWidth: 0
    },
    columnStyles: {
      0: { cellWidth: 25, halign: 'center' },
      1: { cellWidth: 70, halign: 'left' },
      2: { cellWidth: 30, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 35, halign: 'right', fontStyle: 'bold' }
    },
    alternateRowStyles: {
      fillColor: cores.cinzaClaro
    },
    didParseCell: function(data) {
      if (data.section === 'body' && data.column.index === 4) {
        const valor = parseFloat(data.cell.text[0].replace('R$', '').replace('.', '').replace(',', '.')) || 0;
        if (valor > 0) data.cell.styles.textColor = cores.sucesso;
        else if (valor < 0) data.cell.styles.textColor = cores.perigo;
      }
    }
  });

  // RESUMO
  const finalY = doc.lastAutoTable.finalY + 15;
  
  doc.setFillColor(cores.secundaria[0], cores.secundaria[1], cores.secundaria[2]);
  doc.rect(20, finalY, 170, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('RESUMO FINANCEIRO', 25, finalY + 5.5); // Sem emoji
  
  const cardWidth = 82;
  const cardHeight = 40;
  const cardSpacing = 6;
  
  const cards = [
    { titulo: 'TOTAL RECEBIDO', valor: totalRecebido, cor: cores.sucesso },
    { titulo: 'TOTAL PAGO', valor: totalPago, cor: cores.perigo },
    { titulo: 'SALDO PREVIO', valor: dadosCache.saldoPrevio, cor: cores.info },
    { titulo: 'SALDO FINAL', valor: saldoFinal, cor: cores.primaria }
  ];
  
  // Primeira linha
  for (let i = 0; i < 2; i++) {
    const x = 20 + (i * (cardWidth + cardSpacing));
    const y = finalY + 12;
    
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(230, 230, 230);
    doc.roundedRect(x, y, cardWidth, cardHeight, 3, 3, 'FD');
    
    doc.setFillColor(cards[i].cor[0], cards[i].cor[1], cards[i].cor[2]);
    doc.roundedRect(x, y, cardWidth, 5, 1, 1, 'F');
    
    doc.setFontSize(8);
    doc.setTextColor(cores.cinzaEscuro[0], cores.cinzaEscuro[1], cores.cinzaEscuro[2]);
    doc.setFont('helvetica', 'bold');
    doc.text(cards[i].titulo, x + 10, y + 12);
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(cards[i].cor[0], cards[i].cor[1], cards[i].cor[2]);
    doc.text(formatarMoedaPDF(cards[i].valor), x + 10, y + 28);
  }
  
  // Segunda linha
  for (let i = 2; i < 4; i++) {
    const x = 20 + ((i-2) * (cardWidth + cardSpacing));
    const y = finalY + 12 + cardHeight + 8;
    
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(230, 230, 230);
    doc.roundedRect(x, y, cardWidth, cardHeight, 3, 3, 'FD');
    
    doc.setFillColor(cards[i].cor[0], cards[i].cor[1], cards[i].cor[2]);
    doc.roundedRect(x, y, cardWidth, 5, 1, 1, 'F');
    
    doc.setFontSize(8);
    doc.setTextColor(cores.cinzaEscuro[0], cores.cinzaEscuro[1], cores.cinzaEscuro[2]);
    doc.setFont('helvetica', 'bold');
    doc.text(cards[i].titulo, x + 10, y + 12);
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(cards[i].cor[0], cards[i].cor[1], cards[i].cor[2]);
    doc.text(formatarMoedaPDF(cards[i].valor), x + 10, y + 28);
  }

  // STATUS
  const yStatus = finalY + 12 + (cardHeight * 2) + 16;
  
  doc.setFillColor(cores.cinzaClaro[0], cores.cinzaClaro[1], cores.cinzaClaro[2]);
  doc.roundedRect(20, yStatus, 170, 22, 3, 3, 'F');
  
  const saldoMovimentoFormatado = formatarMoedaPDF(saldoMovimento);
  const status = totalRecebido > totalPago ? 'SUPERAVIT' : totalRecebido < totalPago ? 'DEFICIT' : 'EQUILIBRIO';
  const statusCor = totalRecebido > totalPago ? cores.sucesso : totalRecebido < totalPago ? cores.perigo : cores.info;
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(statusCor[0], statusCor[1], statusCor[2]);
  doc.text(`${status}`, 30, yStatus + 14); // Sem emoji
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(cores.cinzaEscuro[0], cores.cinzaEscuro[1], cores.cinzaEscuro[2]);
  doc.text(`Movimentacao: ${saldoMovimentoFormatado}`, 110, yStatus + 14); // Sem acento

  // RODAPÉ
  const dataEmissao = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  
  doc.setDrawColor(cores.primaria[0], cores.primaria[1], cores.primaria[2]);
  doc.setLineWidth(0.5);
  doc.line(20, 280, 190, 280);
  
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.setFont('helvetica', 'italic');
  doc.text(`Documento gerado em ${dataEmissao}`, 105, 287, { align: 'center' });
  doc.text('Sistema DRE Supervila v2.0', 105, 292, { align: 'center' });

  // SALVAR
  const nomeArquivo = `Livro_Caixa_${usuarioLogado.nome.replace(/\s+/g, '_')}_${dataInicio.replace(/\//g, '-')}.pdf`;
  doc.save(nomeArquivo);
  
  Swal.fire({
    icon: 'success',
    title: 'PDF gerado com sucesso!',
    html: `<p>Arquivo: ${nomeArquivo}</p>`,
    confirmButtonColor: '#10b981'
  });
}

// ==================== PDF DRE VISUAL (CORRIGIDO - SEM EMOJIS) ====================
async function gerarPDFDRE() {
  if (!usuarioLogado) return;
  
  const periodo = obterPeriodoDRE();
  if (!periodo) {
    Swal.fire('Período inválido!', '', 'warning');
    return;
  }

  const registrosPeriodo = dadosCache.lista.filter(item => {
    const data = parseDate(item[1]);
    return data && data >= periodo.inicio && data <= periodo.fim;
  });
  
  let receitaBruta = 0, deducoes = 0, custos = 0, despesas = 0;
  
  registrosPeriodo.forEach(item => {
    const valor = parseFloat(String(item[3]).replace(",", ".")) - parseFloat(String(item[4]).replace(",", "."));
    const classificacao = item[5] || 'outro';
    
    if (classificacao === 'receita') receitaBruta += valor;
    else if (classificacao === 'deducao') deducoes += Math.abs(valor);
    else if (classificacao === 'custo') custos += Math.abs(valor);
    else if (classificacao === 'despesa') despesas += Math.abs(valor);
  });
  
  const receitaLiquida = receitaBruta - deducoes;
  const lucroBruto = receitaLiquida - custos;
  const lucroLiquido = lucroBruto - despesas;
  const margemBruta = receitaLiquida > 0 ? (lucroBruto / receitaLiquida) * 100 : 0;
  const margemLiquida = receitaLiquida > 0 ? (lucroLiquido / receitaLiquida) * 100 : 0;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // CORES
  const cores = {
    primaria: [227, 29, 26],
    secundaria: [30, 41, 59],
    sucesso: [16, 185, 129],
    perigo: [239, 68, 68],
    info: [59, 130, 246],
    warning: [245, 158, 11],
    roxo: [139, 92, 246],
    cinzaClaro: [241, 245, 249],
    branco: [255, 255, 255]
  };

  // CABEÇALHO
  doc.setFillColor(cores.secundaria[0], cores.secundaria[1], cores.secundaria[2]);
  doc.rect(0, 0, 210, 35, 'F');
  doc.setFillColor(cores.primaria[0], cores.primaria[1], cores.primaria[2]);
  doc.rect(0, 0, 8, 35, 'F');
  
  doc.setFillColor(cores.primaria[0], cores.primaria[1], cores.primaria[2]);
  doc.circle(25, 17.5, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DRE', 21, 20);
  
  doc.setFontSize(22);
  doc.text('DEMONSTRACAO DE RESULTADOS', 45, 20); // Sem acento
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(usuarioLogado.nome.toUpperCase(), 45, 28);

  // PERÍODO
  const formatarData = d => d ? 
    `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '';
  
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(20, 45, 170, 12, 3, 3, 'F');
  doc.setFontSize(9);
  doc.setTextColor(cores.secundaria[0], cores.secundaria[1], cores.secundaria[2]);
  doc.setFont('helvetica', 'bold');
  doc.text('Periodo:', 25, 53); // Sem acento
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'normal');
  doc.text(`${formatarData(periodo.inicio)} ate ${formatarData(periodo.fim)}`, 50, 53); // "ate" sem acento

  // TABELA DRE
  const body = [
    [{ content: 'RECEITA BRUTA', colSpan: 1 }, { content: formatarMoedaPDF(receitaBruta), styles: { textColor: cores.sucesso, fontStyle: 'bold' } }],
    [{ content: '(-) Deducoes', colSpan: 1 }, { content: formatarMoedaPDF(deducoes), styles: { textColor: cores.warning } }],
    [{ content: '= RECEITA LIQUIDA', colSpan: 1 }, { content: formatarMoedaPDF(receitaLiquida), styles: { textColor: cores.info, fontStyle: 'bold' } }],
    [{ content: '(-) Custos/CMV', colSpan: 1 }, { content: formatarMoedaPDF(custos), styles: { textColor: cores.perigo } }],
    [{ content: '= LUCRO BRUTO', colSpan: 1 }, { content: formatarMoedaPDF(lucroBruto), styles: { textColor: lucroBruto >= 0 ? cores.sucesso : cores.perigo, fontStyle: 'bold' } }],
    [{ content: '(-) Despesas', colSpan: 1 }, { content: formatarMoedaPDF(despesas), styles: { textColor: cores.roxo } }],
    [{ content: '= LUCRO LIQUIDO', colSpan: 1 }, { content: formatarMoedaPDF(lucroLiquido), styles: { textColor: lucroLiquido >= 0 ? cores.sucesso : cores.perigo, fontStyle: 'bold', fontSize: 11 } }]
  ];

  doc.autoTable({
    startY: 65,
    head: [['DESCRICAO', 'VALOR']], // Sem acento
    body: body,
    theme: 'grid',
    styles: {
      fontSize: 10,
      cellPadding: 6,
      font: 'helvetica',
      lineColor: [220, 220, 220]
    },
    headStyles: {
      fillColor: cores.primaria,
      textColor: 255,
      fontSize: 11,
      fontStyle: 'bold',
      halign: 'center'
    },
    columnStyles: {
      0: { cellWidth: 120, halign: 'left' },
      1: { cellWidth: 60, halign: 'right' }
    },
    alternateRowStyles: {
      fillColor: cores.cinzaClaro
    }
  });

  // MARGENS
  const finalY = doc.lastAutoTable.finalY + 15;
  
  doc.setFillColor(cores.roxo[0], cores.roxo[1], cores.roxo[2]);
  doc.rect(20, finalY, 170, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('MARGENS', 25, finalY + 5.5); // Sem emoji
  
  const margens = [
    { titulo: 'MARGEM BRUTA', valor: margemBruta, cor: cores.sucesso },
    { titulo: 'MARGEM LIQUIDA', valor: margemLiquida, cor: cores.roxo }
  ];
  
  margens.forEach((margem, index) => {
    const x = 20 + (index * 85);
    const y = finalY + 15;
    
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(x, y, 80, 35, 3, 3, 'FD');
    
    doc.setFillColor(margem.cor[0], margem.cor[1], margem.cor[2]);
    doc.roundedRect(x, y, 80, 5, 1, 1, 'F');
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text(margem.titulo, x + 10, y + 15);
    
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(margem.cor[0], margem.cor[1], margem.cor[2]);
    doc.text(`${margem.valor.toFixed(2)}%`, x + 10, y + 30);
    
    // Símbolo de porcentagem em vez de checkmark
    doc.setFillColor(margem.cor[0], margem.cor[1], margem.cor[2]);
    doc.circle(x + 65, y + 22, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text('%', x + 64, y + 25);
  });

  // RODAPÉ
  const dataEmissao = new Date().toLocaleDateString('pt-BR');
  doc.setDrawColor(cores.primaria[0], cores.primaria[1], cores.primaria[2]);
  doc.line(20, 280, 190, 280);
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`Documento gerado em ${dataEmissao} - Sistema DRE Supervila`, 105, 287, { align: 'center' });

  doc.save(`DRE_${usuarioLogado.nome.replace(/\s+/g, '_')}.pdf`);
  
  Swal.fire({
    icon: 'success',
    title: 'PDF da DRE gerado!',
    confirmButtonColor: '#10b981'
  });
}
// ==================== UTILITÁRIOS ====================
function mudarTab(id, el) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-" + id).classList.add("active");

  document.querySelectorAll(".bottom-nav .nav-btn, .sidebar .nav-item").forEach(b => b.classList.remove("active"));
  if (el) el.classList.add("active");

  document.querySelector(".content-scroll").scrollTop = 0;

  if (id === "lancar") setTimeout(() => carregarDescricoesSelect(), 50);
  if (id === "dre") setTimeout(() => calcularDRE(), 50);
}

function configurarAtalhosLancamento() {
  document.getElementById("valor")?.addEventListener("keypress", e => e.key === "Enter" && lancar());
}

// ==================== TOTAIS DO LIVRO DE CAIXA ====================
function atualizarTotaisLivroCaixa() {
  const periodo = obterPeriodoFiltro();
  if (!periodo) return;

  const registrosFiltrados = dadosCache.lista.filter(item => {
    const data = parseDate(item[1]);
    return data && data >= periodo.inicio && data <= periodo.fim;
  });

  let totalRecebido = 0;
  let totalPago = 0;

  registrosFiltrados.forEach(item => {
    totalRecebido += parseFloat(String(item[3]).replace(",", ".")) || 0;
    totalPago += parseFloat(String(item[4]).replace(",", ".")) || 0;
  });

  const saldoMovimento = totalRecebido - totalPago;
  const saldoFinal = dadosCache.saldoPrevio + saldoMovimento;

  let totaisContainer = document.getElementById('livroTotais');
  if (!totaisContainer) {
    totaisContainer = document.createElement('div');
    totaisContainer.id = 'livroTotais';
    totaisContainer.className = 'livro-totais';
    
    const libroCards = document.getElementById('libroCards');
    if (libroCards) {
      libroCards.insertAdjacentElement('beforebegin', totaisContainer);
    }
  }

  const periodoInicio = periodo.inicio.toLocaleDateString('pt-BR');
  const periodoFim = periodo.fim.toLocaleDateString('pt-BR');
  const periodoCompacto = window.innerWidth < 480 ? 
    `${periodoInicio} - ${periodoFim}` : 
    `${periodoInicio} até ${periodoFim}`;
  
  const totalGeral = totalRecebido + totalPago;
  const percRecebido = totalGeral > 0 ? ((totalRecebido / totalGeral) * 100).toFixed(1) : 0;
  const percPago = totalGeral > 0 ? ((totalPago / totalGeral) * 100).toFixed(1) : 0;
  
  const status = totalRecebido > totalPago ? 'superavit' : totalRecebido < totalPago ? 'deficit' : 'equilibrio';
  const statusText = totalRecebido > totalPago ? 'SUPERÁVIT' : totalRecebido < totalPago ? 'DÉFICIT' : 'EQUILÍBRIO';
  const statusIcon = totalRecebido > totalPago ? '📈' : totalRecebido < totalPago ? '📉' : '⚖️';
  const statusEmoji = totalRecebido > totalPago ? '✨' : totalRecebido < totalPago ? '⚠️' : '✅';

  totaisContainer.innerHTML = `
    <div class="livro-totais-header">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
      </svg>
      <h4>📊 RESUMO • ${periodoCompacto}</h4>
    </div>
    
    <div class="livro-totais-grid">
      <div class="totais-card">
        <div class="totais-icon recebido">💰</div>
        <div class="totais-content">
          <span class="totais-label">RECEBIDO</span>
          <span class="totais-valor recebido">${fmt(totalRecebido)}</span>
          <div class="totais-detalhe">
            <span>📊 ${percRecebido}%</span>
            <span>📈 +${fmt(totalRecebido)}</span>
          </div>
        </div>
      </div>
      
      <div class="totais-card">
        <div class="totais-icon pago">💸</div>
        <div class="totais-content">
          <span class="totais-label">PAGO</span>
          <span class="totais-valor pago">${fmt(totalPago)}</span>
          <div class="totais-detalhe">
            <span>📊 ${percPago}%</span>
            <span>📉 -${fmt(totalPago)}</span>
          </div>
        </div>
      </div>
      
      <div class="totais-card">
        <div class="totais-icon movimento">📊</div>
        <div class="totais-content">
          <span class="totais-label">MOVIMENTO</span>
          <span class="totais-valor movimento">${fmt(saldoMovimento)}</span>
          <div class="totais-detalhe">
            <span>${saldoMovimento > 0 ? '💰' : saldoMovimento < 0 ? '💸' : '⚖️'}</span>
            <span>${saldoMovimento > 0 ? '+' : ''}${fmt(saldoMovimento)}</span>
          </div>
        </div>
      </div>
      
      <div class="totais-card">
        <div class="totais-icon saldo-final">🏦</div>
        <div class="totais-content">
          <span class="totais-label">SALDO FINAL</span>
          <span class="totais-valor saldo-final">${fmt(saldoFinal)}</span>
          <div class="totais-detalhe">
            <span>📅 ${periodoFim}</span>
            <span>${saldoFinal > 0 ? '💰' : saldoFinal < 0 ? '💸' : '⚖️'}</span>
          </div>
        </div>
      </div>
      
      <div class="livro-resumo">
        <div class="livro-resumo-item">
          <span class="livro-resumo-label">ENTRADAS VS SAÍDAS</span>
          <span class="livro-resumo-valor">${fmt(totalRecebido)} / ${fmt(totalPago)}</span>
        </div>
        <div class="livro-resumo-badge ${status}">
          <span>${statusIcon}</span>
          <span>${statusText}</span>
          <span>${statusEmoji}</span>
        </div>
      </div>
    </div>
  `;
}

// ==================== MARGENS DA DRE ====================
function atualizarMargensDRE() {
  const margemBrutaElement = document.getElementById('dreMargemBruta');
  const margemLiquidaElement = document.getElementById('dreMargemLiquida');
  
  if (!margemBrutaElement || !margemLiquidaElement) return;
  
  const margemBruta = parseFloat(margemBrutaElement.innerText.replace('%', '')) || 0;
  const margemLiquida = parseFloat(margemLiquidaElement.innerText.replace('%', '')) || 0;
  
  const getStatus = (margem) => {
    if (margem >= 30) return { text: 'Excelente', class: 'excelente', icon: '🌟' };
    if (margem >= 15) return { text: 'Boa', class: 'boa', icon: '👍' };
    if (margem >= 5) return { text: 'Regular', class: 'regular', icon: '📊' };
    return { text: 'Atenção', class: 'regular', icon: '⚠️' };
  };
  
  const statusBruta = getStatus(margemBruta);
  const statusLiquida = getStatus(margemLiquida);
  
  let margensContainer = document.getElementById('margensContainer');
  
  if (!margensContainer) {
    margensContainer = document.createElement('div');
    margensContainer.id = 'margensContainer';
    margensContainer.className = 'margens-container';
    
    const marginsSection = document.querySelector('.margins-section');
    if (marginsSection) {
      marginsSection.insertAdjacentElement('afterend', margensContainer);
    } else {
      const dreCards = document.querySelector('.dre-cards');
      if (dreCards) {
        dreCards.insertAdjacentElement('afterend', margensContainer);
      }
    }
  }
  
  margensContainer.innerHTML = `
    <div class="margens-header">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12v-2a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v2"/>
        <circle cx="12" cy="16" r="5"/>
        <path d="M12 11v5"/>
        <path d="M9 8V6"/>
        <path d="M15 8V6"/>
      </svg>
      <h4>📈 ANÁLISE DE MARGENS</h4>
    </div>
    
    <div class="margens-grid">
      <div class="margem-card bruta">
        <div class="margem-icon bruta">📊</div>
        <div class="margem-content">
          <span class="margem-label">MARGEM BRUTA</span>
          <div class="margem-valor bruta">
            ${margemBruta.toFixed(2)}<span class="margem-percentual">%</span>
          </div>
          <div class="margem-status ${statusBruta.class}">
            <span>${statusBruta.icon}</span>
            <span>${statusBruta.text}</span>
          </div>
          <div style="font-size: 12px; color: #64748b; margin-top: 8px;">
            ${margemBruta >= 30 ? '✨ Performance excelente' : 
              margemBruta >= 15 ? '✅ Performance satisfatória' : 
              margemBruta >= 5 ? '📊 Performance regular' : '⚠️ Necessita atenção'}
          </div>
        </div>
        <div class="margem-grafico">
          <svg viewBox="0 0 60 60">
            <circle class="margem-grafico-bg" cx="30" cy="30" r="25" stroke="#e2e8f0" fill="none" stroke-width="6"/>
            <circle class="margem-grafico-fill bruta" cx="30" cy="30" r="25" 
                    stroke="#10b981" fill="none" stroke-width="6"
                    stroke-dasharray="157" 
                    stroke-dashoffset="${157 - (157 * margemBruta / 100)}"/>
          </svg>
          <div class="margem-grafico-texto">${Math.round(margemBruta)}%</div>
        </div>
      </div>
      
      <div class="margem-card liquida">
        <div class="margem-icon liquida">📈</div>
        <div class="margem-content">
          <span class="margem-label">MARGEM LÍQUIDA</span>
          <div class="margem-valor liquida">
            ${margemLiquida.toFixed(2)}<span class="margem-percentual">%</span>
          </div>
          <div class="margem-status ${statusLiquida.class}">
            <span>${statusLiquida.icon}</span>
            <span>${statusLiquida.text}</span>
          </div>
          <div style="font-size: 12px; color: #64748b; margin-top: 8px;">
            ${margemLiquida >= 20 ? '✨ Lucratividade excelente' : 
              margemLiquida >= 10 ? '✅ Lucratividade boa' : 
              margemLiquida >= 3 ? '📊 Lucratividade regular' : '⚠️ Baixa lucratividade'}
          </div>
        </div>
        <div class="margem-grafico">
          <svg viewBox="0 0 60 60">
            <circle class="margem-grafico-bg" cx="30" cy="30" r="25" stroke="#e2e8f0" fill="none" stroke-width="6"/>
            <circle class="margem-grafico-fill liquida" cx="30" cy="30" r="25" 
                    stroke="#8b5cf6" fill="none" stroke-width="6"
                    stroke-dasharray="157" 
                    stroke-dashoffset="${157 - (157 * margemLiquida / 100)}"/>
          </svg>
          <div class="margem-grafico-texto">${Math.round(margemLiquida)}%</div>
        </div>
      </div>
    </div>
    
    <div style="display: flex; gap: 20px; justify-content: center; margin-top: 16px; padding-top: 12px; border-top: 1px dashed #e2e8f0; font-size: 11px; color: #64748b;">
      <span>🌟 Excelente (≥30%)</span>
      <span>✅ Bom (15-29%)</span>
      <span>📊 Regular (5-14%)</span>
      <span>⚠️ Atenção (&lt;5%)</span>
    </div>
  `;
}

// ==================== PWA INSTALL PROMPT ====================
let deferredPrompt;
const installButton = document.createElement('button');

function createInstallButton() {
  installButton.id = 'install-button';
  installButton.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    <span>Instalar App</span>
  `;
  
  installButton.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    background: #e31d1a;
    color: white;
    border: none;
    border-radius: 50px;
    padding: 12px 20px;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    font-weight: 600;
    display: none;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(227, 29, 26, 0.3);
    cursor: pointer;
    z-index: 1000;
    transition: all 0.3s ease;
    border: 1px solid rgba(255, 255, 255, 0.2);
  `;
  
  installButton.addEventListener('mouseenter', () => {
    installButton.style.transform = 'translateY(-2px)';
    installButton.style.boxShadow = '0 6px 16px rgba(227, 29, 26, 0.4)';
  });
  
  installButton.addEventListener('mouseleave', () => {
    installButton.style.transform = 'translateY(0)';
    installButton.style.boxShadow = '0 4px 12px rgba(227, 29, 26, 0.3)';
  });
  
  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('Usuário aceitou instalar o app');
      installButton.style.display = 'none';
    }
    
    deferredPrompt = null;
  });
  
  document.body.appendChild(installButton);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  
  if (!window.matchMedia('(display-mode: standalone)').matches) {
    installButton.style.display = 'flex';
  }
});

window.addEventListener('appinstalled', () => {
  console.log('App instalado com sucesso!');
  installButton.style.display = 'none';
  deferredPrompt = null;
});

window.addEventListener('load', () => {
  if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('App rodando em modo standalone');
    document.body.classList.add('app-mode');
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('ServiceWorker registrado com sucesso:', registration.scope);
      })
      .catch(error => {
        console.log('Falha no registro do ServiceWorker:', error);
      });
  });
}

window.addEventListener('online', () => {
  document.body.classList.remove('offline');
  if (typeof mostrarNotificacao === 'function') {
    mostrarNotificacao('✅ Conexão restabelecida', 'success');
  }
});

window.addEventListener('offline', () => {
  document.body.classList.add('offline');
  if (typeof mostrarNotificacao === 'function') {
    mostrarNotificacao('📴 Modo offline - Dados podem estar desatualizados', 'warning');
  }
});

createInstallButton();

const style = document.createElement('style');
style.textContent = `
  .offline .content-scroll {
    opacity: 0.8;
  }
  
  .app-mode {
    padding-bottom: env(safe-area-inset-bottom);
  }
  
  .app-mode .bottom-nav {
    padding-bottom: max(env(safe-area-inset-bottom), 8px);
  }
  
  @media (min-width: 1024px) {
    #install-button {
      bottom: 30px;
      right: 30px;
    }
  }
  
  @media (max-width: 480px) {
    #install-button {
      bottom: 70px;
      right: 15px;
      padding: 10px 16px;
      font-size: 13px;
    }
    
    #install-button svg {
      width: 18px;
      height: 18px;
    }
  }
`;
document.head.appendChild(style);

// ==================== EXPORTAR FUNÇÕES ====================
window.toggleSenha = toggleSenha;
window.verificarLogin = verificarLogin;
window.onEmpresaChange = onEmpresaChange;
window.mudarTab = mudarTab;
window.fazerLogout = fazerLogout;
window.lancar = lancar;
window.limparCamposLancamento = limparCamposLancamento;
window.preencherDescricao = preencherDescricao;
window.cadastrarDescricao = cadastrarDescricao;
window.salvarConfiguracoes = salvarConfiguracoes;
window.atualizarFiltroPeriodo = atualizarFiltroPeriodo;
window.gerarPDFLivroCaixa = gerarPDFLivroCaixa;
window.gerarPDFDRE = gerarPDFDRE;
window.abrirModal = abrirModal;
window.fecharModal = fecharModal;
window.salvarEditar = salvarEditar;
window.atualizarDrePeriodo = atualizarDrePeriodo;
window.toggleDetalhamento = toggleDetalhamento;
window.excluirTodosLancamentos = excluirTodosLancamentos;
window.excluirLancamento = excluirLancamento;
window.removerDescricao = removerDescricao;           
window.toggleCategoria = toggleCategoria;             

// ==================== AJUSTES PARA CELULAR ====================
function adjustForMobile() {
  if (window.innerWidth <= 768) {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
    
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) {
      const navHeight = bottomNav.offsetHeight;
      document.documentElement.style.setProperty('--bottom-nav-height', `${navHeight}px`);
    }
    
    const contentScroll = document.querySelector('.content-scroll');
    if (contentScroll) {
      contentScroll.scrollTop = 0;
    }
  }
}

let originalViewportHeight = window.innerHeight;

window.addEventListener('resize', () => {
  if (window.innerWidth <= 768) {
    const currentHeight = window.innerHeight;
    
    if (originalViewportHeight - currentHeight > 100) {
      document.body.classList.add('keyboard-open');
      
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'SELECT' || activeElement.tagName === 'TEXTAREA')) {
        setTimeout(() => {
          activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    } else {
      document.body.classList.remove('keyboard-open');
    }
    
    originalViewportHeight = currentHeight;
  }
});

window.addEventListener('load', adjustForMobile);
window.addEventListener('orientationchange', adjustForMobile);
window.addEventListener('resize', adjustForMobile);

const observer = new MutationObserver(() => {
  setTimeout(adjustForMobile, 100);
});

observer.observe(document.querySelector('.content-scroll') || document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class']
});

// ==================== SERVICE WORKER CORRIGIDO ====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(registration => {
        console.log('ServiceWorker registrado com sucesso:', registration.scope);
        
        // Verificar se há atualização
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          console.log('Novo ServiceWorker detectado');
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Nova versão disponível
              console.log('Nova versão disponível');
            }
          });
        });
      })
      .catch(error => {
        console.log('Falha no registro do ServiceWorker:', error);
      });
    
    // Verificar se já está instalado
    navigator.serviceWorker.ready.then(registration => {
      console.log('ServiceWorker pronto');
    });
  });
}

// ==================== ATUALIZAÇÃO HÍBRIDA ====================
async function atualizarDadosHibrido() {
  if (!usuarioLogado) {
    mostrarNotificacao('❌ Faça login primeiro', 'error');
    return;
  }

  const logos = document.querySelectorAll('.logo-top, .logo-sidebar');
  
  // Desabilitar cliques durante atualização
  logos.forEach(logo => {
    logo.style.pointerEvents = 'none';
    logo.classList.add('girando');
  });

  // Desabilitar botões durante atualização
  const botoes = document.querySelectorAll('button');
  botoes.forEach(btn => btn.disabled = true);

  try {
    // Mostrar loading global
    Swal.fire({
      title: 'Atualizando...',
      text: 'Buscando novos lançamentos',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    // Recarregar dados
    await atualizarTabela();
    await calcularDRE();
    await carregarDescricoesSelect();
    
    Swal.close();
    
    // Mostrar toast de sucesso
    mostrarToastPersonalizado({
      titulo: '✅ Atualizado!',
      mensagem: 'Dados sincronizados com sucesso',
      tipo: 'success',
      tempo: 2000
    });
    
  } catch (error) {
    Swal.close();
    mostrarToastPersonalizado({
      titulo: '❌ Erro',
      mensagem: 'Falha na atualização',
      tipo: 'error',
      tempo: 3000
    });
  } finally {
    // Reabilitar elementos
    logos.forEach(logo => {
      logo.style.pointerEvents = 'auto';
      setTimeout(() => logo.classList.remove('girando'), 500);
    });
    
    botoes.forEach(btn => btn.disabled = false);
  }
}

// Adicionar evento de clique
document.addEventListener('DOMContentLoaded', function() {
  const logos = document.querySelectorAll('.logo-top, .logo-sidebar');
  logos.forEach(logo => {
    logo.addEventListener('click', atualizarDadosHibrido);
    logo.style.cursor = 'pointer';
    logo.title = 'Clique para atualizar dados';
  });
});



// Debug para verificar se o bottom-nav está visível
window.addEventListener('load', function() {
  console.log('App carregado');
  console.log('Bottom-nav visível?', document.querySelector('.bottom-nav').offsetParent !== null);
  console.log('Display mode:', window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser');
  
  // Forçar bottom-nav a aparecer se estiver oculto
  setTimeout(() => {
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav && bottomNav.offsetParent === null) {
      console.log('Forçando bottom-nav a aparecer');
      bottomNav.style.display = 'flex';
      bottomNav.style.visibility = 'visible';
      bottomNav.style.opacity = '1';
    }
  }, 1000);
});