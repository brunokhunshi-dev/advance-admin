function escapeText(value){
    return String(value??"").replace(/[&<>"']/g,char=>({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[char]));
}

export function preparePrintWindow(label="Preparando documento"){
    const popup=window.open("","_blank");
    if(!popup)throw new Error("O navegador bloqueou a janela de impressão. Permita pop-ups para exportar em PDF.");
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeText(label)}</title><style>
        body{margin:0;padding:32px;font:14px Arial,sans-serif;color:#25252d;background:#f5f5f7}
        .loading{max-width:560px;margin:12vh auto;padding:28px;background:#fff;border-radius:14px}
        strong{display:block;margin-bottom:7px;color:#061b52;font-size:18px}
        span{color:#71717b}
    </style></head><body><div class="loading"><strong>${escapeText(label)}</strong><span>Organizando as informações para impressão...</span></div></body></html>`);
    popup.document.close();
    return popup;
}

export function printDocument(spec,popup=null){
    const target=popup||preparePrintWindow(spec?.title||"Documento");
    const title=escapeText(spec?.title||"Documento");
    const kicker=escapeText(spec?.kicker||"ADVANCE CHECK");
    const subtitle=escapeText(spec?.subtitle||"");
    const badge=escapeText(spec?.badge||"");
    const generatedAt=escapeText(spec?.generatedAt||new Date().toLocaleString("pt-BR"));
    const meta=Array.isArray(spec?.meta)?spec.meta:[];
    const sections=Array.isArray(spec?.sections)?spec.sections:[];
    const logoUrl=new URL("./midia/logo-advancecheck.svg",window.location.href).href;

    const metaHtml=meta.length?`<section class="meta-grid">${meta.map(item=>`
        <div class="meta-item"><span>${escapeText(item?.label||"")}</span><strong>${escapeText(item?.value||"—")}</strong></div>
    `).join("")}</section>`:"";

    const sectionsHtml=sections.map(section=>`
        <section class="doc-section ${section?.breakBefore?"page-break":""}">
            ${section?.eyebrow?`<span class="section-eyebrow">${escapeText(section.eyebrow)}</span>`:""}
            ${section?.title?`<h2>${escapeText(section.title)}</h2>`:""}
            ${section?.subtitle?`<p class="section-subtitle">${escapeText(section.subtitle)}</p>`:""}
            <div class="section-content">${section?.html||""}</div>
        </section>
    `).join("");

    target.document.open();
    target.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
    @page{size:A4;margin:14mm 14mm 16mm}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff;color:#25252d;font-family:Arial,Helvetica,sans-serif}
    body{font-size:10.5pt;line-height:1.45}
    .document{width:100%}
    .doc-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16mm;padding-bottom:7mm;border-bottom:1.5px solid #061b52}
    .brand{display:flex;align-items:center;gap:4mm;min-width:0}
    .brand img{width:34mm;max-height:14mm;object-fit:contain;object-position:left center}
    .brand-copy{min-width:0}
    .kicker,.section-eyebrow,.meta-item span{display:block;color:#777782;font-size:7.5pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    h1{margin:1.5mm 0 0;color:#061b52;font-size:20pt;line-height:1.08;letter-spacing:-.02em}
    .subtitle{margin:2mm 0 0;color:#585863;font-size:9.5pt}
    .badge{flex:0 0 auto;padding:2.2mm 3.2mm;border:1px solid #d7d8de;border-radius:999px;color:#061b52;font-size:8pt;font-weight:700}
    .meta-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:7mm 0;background:#dedfe5;border:1px solid #dedfe5}
    .meta-item{min-width:0;padding:3.2mm 3.5mm;background:#fff}
    .meta-item strong{display:block;margin-top:1mm;color:#26262e;font-size:9.2pt;overflow-wrap:anywhere}
    .doc-section{margin-top:8mm}
    .doc-section h2{margin:1.2mm 0 0;color:#061b52;font-size:13pt;line-height:1.2}
    .section-subtitle{margin:1.5mm 0 0;color:#73737d;font-size:8.5pt}
    .section-content{margin-top:4mm}
    .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:3mm 6mm}
    .field{padding:0 0 2.5mm;border-bottom:1px solid #e6e6ea;break-inside:avoid}
    .field.wide{grid-column:1/-1}
    .field span{display:block;color:#85858e;font-size:7.4pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
    .field strong{display:block;margin-top:1mm;color:#2d2d35;font-size:9.3pt;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}
    .prose{white-space:pre-wrap;overflow-wrap:anywhere;font-size:10pt;line-height:1.6}
    .note{padding:4mm 4.5mm;border-left:2.5px solid #061b52;background:#f5f6f8;white-space:pre-wrap;overflow-wrap:anywhere}
    table{width:100%;border-collapse:collapse;font-size:8.5pt}
    th{text-align:left;padding:2.5mm 2mm;border-bottom:1.5px solid #061b52;color:#061b52;font-size:7.5pt;text-transform:uppercase;letter-spacing:.04em}
    td{padding:2.4mm 2mm;border-bottom:1px solid #e5e5e9;vertical-align:top;overflow-wrap:anywhere}
    tr{break-inside:avoid}
    .timeline{display:grid;gap:3mm}
    .timeline-item{display:grid;grid-template-columns:20mm 1fr;gap:4mm;padding-bottom:3mm;border-bottom:1px solid #e5e5e9;break-inside:avoid}
    .timeline-item b{color:#061b52}
    .timeline-item small{display:block;color:#777782}
    .report-block{margin:0 0 3mm;white-space:pre-wrap;overflow-wrap:anywhere}
    .attachment{
        width:min(100mm,100%);
        margin:4mm auto;
        padding:3mm;
        border:1px solid #dedfe5;
        break-inside:avoid;
        background:#fff
    }
    .attachment img{
        display:block;
        width:auto;
        height:auto;
        max-width:88mm;
        max-height:68mm;
        margin:0 auto;
        object-fit:contain
    }
    .attachment figcaption{
        margin-top:2mm;
        color:#6d6d76;
        font-size:7.5pt;
        text-align:center;
        overflow-wrap:anywhere
    }
    .signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:18mm;margin-top:15mm}
    .signature{padding-top:3mm;border-top:1px solid #909099;text-align:center;color:#686871;font-size:8pt}
    .doc-footer{display:flex;justify-content:space-between;gap:8mm;margin-top:10mm;padding-top:4mm;border-top:1px solid #dedfe5;color:#8a8a93;font-size:7.5pt}
    .page-break{break-before:page}
    @media(max-width:700px){
        .meta-grid{grid-template-columns:1fr 1fr}
        .field-grid{grid-template-columns:1fr}
        .field.wide{grid-column:auto}
    }
    @media print{
        a{color:inherit;text-decoration:none}
        .field,.attachment,tr{break-inside:avoid}
        .doc-section{break-inside:auto}
    }
</style>
</head>
<body>
<main class="document">
<header class="doc-header">
    <div class="brand">
        <img src="${logoUrl}" alt="Advance Check">
        <div class="brand-copy"><span class="kicker">${kicker}</span><h1>${title}</h1>${subtitle?`<p class="subtitle">${subtitle}</p>`:""}</div>
    </div>
    ${badge?`<span class="badge">${badge}</span>`:""}
</header>
${metaHtml}
${sectionsHtml}
<footer class="doc-footer"><span>Advance Tintas • Advance Check</span><span>Gerado em ${generatedAt}</span></footer>
</main>
<script>
(function(){
    const images=[...document.images];
    const settled=images.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{
        img.addEventListener("load",resolve,{once:true});
        img.addEventListener("error",resolve,{once:true});
        setTimeout(resolve,5000);
    }));
    Promise.all(settled).finally(()=>setTimeout(()=>window.print(),250));
})();
</script>
</body>
</html>`);
    target.document.close();
    target.focus();
    return target;
}
