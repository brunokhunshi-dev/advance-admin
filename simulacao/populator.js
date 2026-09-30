const BASE_DATE=new Date("2026-09-30T15:00:00-03:00");

function hashSeed(seed){
  let h=2166136261>>>0;
  for(const ch of String(seed||"ADVANCE-DEMO")){
    h^=ch.charCodeAt(0);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}
function mulberry32(a){
  return function(){
    let t=a+=0x6D2B79F5;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return((t^t>>>14)>>>0)/4294967296;
  };
}
const pick=(rng,list)=>list[Math.floor(rng()*list.length)];
const int=(rng,min,max)=>Math.floor(rng()*(max-min+1))+min;
const chance=(rng,p)=>rng()<p;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

const PROMOTERS=[
  "Lucas Almeida","Mariana Costa","Rafael Nogueira","Camila Ferreira","Diego Martins",
  "Larissa Rocha","Gustavo Ribeiro","Beatriz Moreira","Felipe Azevedo","Natália Barros"
];
const ASSISTANTS=[
  "André Farias","Juliana Mendes","Caio Fernandes","Renata Lima","Thiago Prado","Isabela Moraes"
];
const CITIES=[
  {cidade:"Indaiatuba",uf:"SP",lat:-23.0892,lng:-47.2188},
  {cidade:"Campinas",uf:"SP",lat:-22.9056,lng:-47.0608},
  {cidade:"Itu",uf:"SP",lat:-23.2642,lng:-47.2996},
  {cidade:"Salto",uf:"SP",lat:-23.2008,lng:-47.2869},
  {cidade:"Sorocaba",uf:"SP",lat:-23.5015,lng:-47.4526},
  {cidade:"Jundiaí",uf:"SP",lat:-23.1857,lng:-46.8978},
  {cidade:"Americana",uf:"SP",lat:-22.7392,lng:-47.3314},
  {cidade:"Paulínia",uf:"SP",lat:-22.7542,lng:-47.1480},
  {cidade:"Hortolândia",uf:"SP",lat:-22.8583,lng:-47.2200},
  {cidade:"Piracicaba",uf:"SP",lat:-22.7253,lng:-47.6492}
];
const CLIENT_PREFIX=[
  "Tintas","Casa das Tintas","Distribuidora","Pinturas","Industrial","Comercial",
  "Revestimentos","Ferragens","Materiais","Soluções"
];
const CLIENT_SUFFIX=[
  "Horizonte","Aurora","Nova Era","Imperial","Paulista","Central","Bandeirantes","Pioneira",
  "Vale Azul","Primavera","Progresso","Real","Nacional","Vértice","Aliança","União","Fortaleza",
  "Interlagos","Planalto","Vanguarda"
];

function fakeCnpj(rng,index){
  const root=String(10000000+((index*7919+int(rng,0,99999))%89999999)).padStart(8,"0");
  const branch="0001";
  const base=root+branch;
  const digit=(value)=>{
    const weights=value.length===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
    const sum=value.split("").reduce((acc,n,i)=>acc+Number(n)*weights[i],0);
    const mod=sum%11;
    return mod<2?0:11-mod;
  };
  const d1=digit(base),d2=digit(base+d1);
  return base+d1+d2;
}
function formatCnpj(raw){
  return String(raw).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,"$1.$2.$3/$4-$5");
}
function makeDate(rng,daysBack){
  const d=new Date(BASE_DATE);
  d.setDate(d.getDate()-daysBack);
  d.setHours(int(rng,8,16),pick(rng,[0,10,20,30,40,50]),0,0);
  return d;
}
function iso(d){return d.toISOString()}
function durationMinutes(a){
  if(!a.checkinDataHora||!a.checkoutDataHora)return null;
  return Math.max(0,(new Date(a.checkoutDataHora)-new Date(a.checkinDataHora))/60000);
}

function makeProfessionals(){
  return[
    ...PROMOTERS.map((nome,i)=>({
      id:"PROM-"+String(i+1).padStart(2,"0"),nome,
      email:nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,".")+"@demo.advance",
      telefone:"(19) 9"+String(20000000+i*17321).slice(-8),
      cargo:"Promotor Técnico",collection:"promotores",ativo:true
    })),
    ...ASSISTANTS.map((nome,i)=>({
      id:"ASSIST-"+String(i+1).padStart(2,"0"),nome,
      email:nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,".")+"@demo.advance",
      telefone:"(19) 9"+String(40000000+i*21911).slice(-8),
      cargo:"Assistente Técnico",collection:"assistencia",ativo:true
    }))
  ];
}
function makeClients(rng,count){
  const used=new Set();
  return Array.from({length:count},(_,i)=>{
    let nome;
    do{nome=pick(rng,CLIENT_PREFIX)+" "+pick(rng,CLIENT_SUFFIX)}while(used.has(nome));
    used.add(nome);
    const city=pick(rng,CITIES);
    const raw=fakeCnpj(rng,i+1);
    return{
      id:"CLI-CNPJ-"+raw,
      nome,cnpj:raw,cnpjFormatado:formatCnpj(raw),cnpjFicticio:true,
      cidade:city.cidade,uf:city.uf,
      enderecoCompleto:"Rua "+pick(rng,["das Acácias","Industrial","São Bento","Nove de Julho","dos Ipês","Brasil","do Comércio","das Palmeiras"])+", "+int(rng,40,1850)+" — "+city.cidade+"/"+city.uf,
      lat:city.lat+(rng()-.5)*.07,lng:city.lng+(rng()-.5)*.07,
      status:chance(rng,.96)?"Ativo":"Inativo",
      importancia:pick(rng,["Não definida","Baixa","Média","Média","Alta","Alta","Estratégico"])
    };
  });
}
function visitTypeFor(rng,professional){
  if(professional.collection==="assistencia"){
    return chance(rng,.84)?"Assistência técnica":chance(rng,.65)?"Treinamento":"Visita comercial";
  }
  const r=rng();
  return r<.72?"Visita comercial":r<.90?"Treinamento":"Assistência técnica";
}
function statusFor(rng,daysBack){
  if(daysBack===0){
    const r=rng();
    if(r<.32)return"Em andamento";
    if(r<.58)return"Pendente";
    if(r<.93)return"Concluída";
    return"Cancelada";
  }
  const r=rng();
  if(daysBack<=3&&r<.12)return"Pendente";
  if(r<.83)return"Concluída";
  if(r<.90)return"Cancelada";
  if(r<.96)return"Pendente";
  return"Concluída";
}
function makeReport(rng,visit,client,professional){
  const type=visit.tipoVisita;
  if(type==="Assistência técnica"){
    const produto=pick(rng,["Epóxi Total","ADZINC 9500","Adepoxi ARA 1210","Ecovance SF 102","Polivance","Hotvance"]);
    const queixa=pick(rng,[
      "Baixa aderência observada em um trecho da aplicação.",
      "Cliente solicitou avaliação de acabamento e espessura.",
      "Ocorrência localizada de desgaste prematuro.",
      "Avaliação preventiva do sistema antes de nova aplicação."
    ]);
    return{
      codigo:"REL-"+visit.id,
      textoAtual:"Inspeção realizada em campo. Foram avaliadas as condições do substrato, preparo e aplicação do sistema.",
      produto,clienteFinal:client.nome,resultado:pick(rng,["Resolvido","Orientação técnica","Acompanhamento necessário"]),
      queixa,proximoPasso:pick(rng,["Acompanhar próxima aplicação","Enviar orientação técnica","Retorno em 15 dias","Sem ação adicional"]),
      conteudoRelatorio:{versao:1,blocos:[
        {kind:"text",text:"Durante a visita técnica foram avaliadas as condições de aplicação do "+produto+"."},
        {kind:"text",text:"A equipe recebeu orientação sobre preparo, mistura e intervalo entre demãos. "+queixa}
      ]}
    };
  }
  if(type==="Treinamento"){
    return{
      codigo:"REL-"+visit.id,
      textoAtual:"Treinamento concluído com demonstração prática, esclarecimento de dúvidas e revisão do processo de aplicação.",
      conteudoRelatorio:{versao:1,blocos:[{kind:"text",text:"Treinamento realizado com a equipe do cliente, incluindo demonstração prática e espaço para dúvidas."}]}
    };
  }
  return{
    codigo:"REL-"+visit.id,
    textoAtual:pick(rng,[
      "Visita comercial para acompanhamento da carteira, apresentação de soluções e levantamento de oportunidades.",
      "Reunião com o cliente para revisão de mix, estoque e oportunidades de novos produtos.",
      "Acompanhamento comercial com foco em relacionamento, giro e próximos pedidos."
    ]),
    conteudoRelatorio:{versao:1,blocos:[{kind:"text",text:"Visita concluída. Foram revisadas oportunidades comerciais e próximos passos com o cliente."}]}
  };
}
function makeVisit(rng,index,professionals,clients,days){
  const professional=pick(rng,professionals);
  const client=pick(rng,clients.filter(c=>c.status==="Ativo"));
  const daysBack=int(rng,0,days-1);
  const data=makeDate(rng,daysBack);
  const status=statusFor(rng,daysBack);
  const tipoVisita=visitTypeFor(rng,professional);
  const duration=int(rng,tipoVisita==="Treinamento"?55:35,tipoVisita==="Assistência técnica"?210:150);
  const checkin=status==="Concluída"||status==="Em andamento"?new Date(data):null;
  if(checkin)checkin.setMinutes(checkin.getMinutes()+int(rng,-10,20));
  const checkout=status==="Concluída"?new Date(checkin.getTime()+duration*60000):null;
  const visit={
    id:"VIS-DEMO-"+String(index+1).padStart(4,"0"),
    data:iso(data),ptvId:professional.id,clienteId:client.id,tipoVisita,status,
    nota:chance(rng,.42)?pick(rng,["Revisar estoque na próxima visita.","Cliente pediu retorno com condição comercial.","Acompanhar aplicação com a equipe técnica.","Contato receptivo, oportunidade em andamento.","Sem observações adicionais."]):"",
    checkinDataHora:checkin?iso(checkin):null,checkoutDataHora:checkout?iso(checkout):null,
    checkinGps:checkin?client.lat.toFixed(6)+","+client.lng.toFixed(6):null,
    checkoutGps:checkout?(client.lat+(rng()-.5)*.002).toFixed(6)+","+(client.lng+(rng()-.5)*.002).toFixed(6):null,
    checkinEndereco:checkin?client.enderecoCompleto:null,checkoutEndereco:checkout?client.enderecoCompleto:null
  };
  if(tipoVisita==="Visita comercial"){
    visit.objetivo=pick(rng,["Relacionamento","Demonstração de produto","Revisão de estoque","Prospecção de oportunidades","Acompanhamento de pedido"]);
    visit.oportunidadeIdentificada=chance(rng,.58)?"Sim":"Não";
    visit.resultado=chance(rng,.7)?"Oportunidade em acompanhamento":"Visita de relacionamento";
  }else if(tipoVisita==="Treinamento"){
    visit.categoriaTreinamento=pick(rng,["Aplicação","Produto","Sistema de pintura","Tingimento STR"]);
    visit.quantidadeParticipantes=int(rng,3,22);
    visit.publicoAtendido=pick(rng,["Vendedores","Aplicadores","Equipe técnica","Comercial e técnico"]);
    visit.resultado="Treinamento realizado";
  }else{
    visit.resultado=pick(rng,["Resolvido","Pendente de análise","Orientação técnica"]);
  }
  if(status==="Concluída"&&chance(rng,.94))visit.report=makeReport(rng,visit,client,professional);
  return visit;
}

export function createScenario(seed="ADVANCE-DEMO-2026",options={}){
  const rng=mulberry32(hashSeed(seed));
  const days=clamp(Number(options.days)||120,30,365);
  const visitCount=clamp(Number(options.visits)||420,80,1200);
  const clientCount=clamp(Number(options.clients)||64,24,160);
  const professionals=makeProfessionals();
  const clients=makeClients(rng,clientCount);
  const visits=Array.from({length:visitCount},(_,i)=>makeVisit(rng,i,professionals,clients,days));

  // Garante uma operação viva no dia atual.
  const activePros=professionals.slice(0,5);
  activePros.forEach((professional,i)=>{
    const client=clients[(i*7+3)%clients.length];
    const d=new Date(BASE_DATE);d.setHours(9+i,10+i*3,0,0);
    const tipoVisita=visitTypeFor(rng,professional);
    visits.unshift({
      id:"VIS-LIVE-"+String(i+1).padStart(2,"0"),data:iso(d),ptvId:professional.id,clienteId:client.id,
      tipoVisita,status:i<3?"Em andamento":"Pendente",
      nota:"Cenário ativo gerado pelo populador.",
      checkinDataHora:i<3?iso(new Date(d.getTime()+10*60000)):null,
      checkoutDataHora:null,
      checkinGps:i<3?client.lat.toFixed(6)+","+client.lng.toFixed(6):null,
      checkinEndereco:i<3?client.enderecoCompleto:null
    });
  });

  visits.sort((a,b)=>new Date(b.data)-new Date(a.data));
  return{
    meta:{seed,generatedAt:BASE_DATE.toISOString(),days,visitCount:visits.length,clientCount:clients.length},
    professionals,clients,visits
  };
}

export function scenarioSummary(scenario){
  const completed=scenario.visits.filter(v=>v.status==="Concluída");
  const durations=completed.map(durationMinutes).filter(Number.isFinite);
  return{
    professionals:scenario.professionals.length,
    promoters:scenario.professionals.filter(p=>p.collection==="promotores").length,
    assistants:scenario.professionals.filter(p=>p.collection==="assistencia").length,
    clients:scenario.clients.length,
    visits:scenario.visits.length,
    completed:completed.length,
    inProgress:scenario.visits.filter(v=>v.status==="Em andamento").length,
    pending:scenario.visits.filter(v=>v.status==="Pendente").length,
    averageDuration:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:0
  };
}
