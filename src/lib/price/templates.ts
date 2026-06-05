export type AdFormat = '9x16' | '1x1' | '4x5' | '16x9' | '4x3'

export interface FormatSpec {
  label: string
  width: number
  height: number
  aspect: string
}

export const FORMAT_SPECS: Record<AdFormat, FormatSpec> = {
  '9x16':  { label: 'Story / Reel', width: 540,  height: 960,  aspect: '9/16'  },
  '1x1':   { label: 'Feed cuadrado', width: 600, height: 600,  aspect: '1/1'   },
  '4x5':   { label: 'Feed vertical', width: 480, height: 600,  aspect: '4/5'   },
  '16x9':  { label: 'Banner / Portada', width: 960, height: 540, aspect: '16/9' },
  '4x3':   { label: 'Banner horizontal', width: 800, height: 600, aspect: '4/3' },
}

export interface PieceVars {
  PROJECT_NAME: string
  CITY: string
  TAGLINE: string
  PRICE: string
  SMMLV: string
  AREAS: string
  BG_URL: string
}

// Generates the HTML for a price piece preview
export function renderPieceHtml(format: AdFormat, vars: PieceVars): string {
  const { width, height } = FORMAT_SPECS[format] ?? FORMAT_SPECS['9x16']
  const isVertical = height > width

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:${width}px;height:${height}px;overflow:hidden;font-family:'Montserrat',Arial,sans-serif;}
  .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
  .overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.05) 0%,rgba(0,0,0,0.45) 60%,rgba(0,0,0,0.75) 100%);}
  .logo-area{position:absolute;top:${isVertical?'32px':'20px'};left:50%;transform:translateX(-50%);
    background:white;padding:${isVertical?'12px 20px':'8px 14px'};border-radius:8px;text-align:center;}
  .logo-text{font-size:${isVertical?'22px':'16px'};font-weight:900;letter-spacing:2px;color:#1B3D6B;}
  .logo-icon{display:inline-block;width:${isVertical?'24px':'18px'};height:${isVertical?'24px':'18px'};
    background:#FABD02;margin-right:6px;vertical-align:middle;clip-path:polygon(0 0,100% 0,100% 100%,0 100%,0 0,20% 20%,80% 20%,80% 80%,20% 80%,20% 20%);}
  .badge{position:absolute;top:${isVertical?'130px':'80px'};left:50%;transform:translateX(-50%);
    background:#FABD02;color:#1B3D6B;font-size:${isVertical?'13px':'11px'};font-weight:800;
    padding:${isVertical?'6px 16px':'4px 12px'};border-radius:20px;letter-spacing:1px;white-space:nowrap;text-align:center;}
  .content{position:absolute;bottom:${isVertical?'${Math.round(height*0.08)}px':'40px'};left:32px;right:32px;}
  .project-name{font-size:${isVertical?'28px':'20px'};font-weight:900;color:white;
    text-transform:uppercase;letter-spacing:1px;line-height:1.15;margin-bottom:4px;text-shadow:0 2px 8px rgba(0,0,0,0.5);}
  .tagline{font-size:${isVertical?'14px':'11px'};color:rgba(255,255,255,0.85);margin-bottom:${isVertical?'12px':'8px'};line-height:1.3;}
  .areas-line{font-size:${isVertical?'15px':'12px'};color:rgba(255,255,255,0.9);font-weight:600;margin-bottom:${isVertical?'10px':'6px'};}
  .price-box{background:rgba(27,61,107,0.85);border-radius:10px;padding:${isVertical?'12px 16px':'8px 12px'};display:inline-block;margin-bottom:${isVertical?'8px':'4px'};}
  .price-label{font-size:${isVertical?'11px':'9px'};color:#FABD02;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:2px;}
  .price-value{font-size:${isVertical?'26px':'18px'};font-weight:900;color:white;line-height:1;}
  .smmlv{font-size:${isVertical?'13px':'10px'};color:#FABD02;font-weight:700;margin-top:2px;}
  .disclaimer{position:absolute;bottom:${isVertical?'16px':'10px'};left:16px;right:16px;
    font-size:${isVertical?'8px':'7px'};color:rgba(255,255,255,0.5);line-height:1.4;text-align:center;}
</style>
</head>
<body>
  ${vars.BG_URL ? `<img class="bg" src="${vars.BG_URL}" crossorigin="anonymous"/>` : `<div class="bg" style="background:linear-gradient(135deg,#1B3D6B 0%,#2d5a9e 50%,#FABD02 100%);"></div>`}
  <div class="overlay"></div>

  <!-- Logo -->
  <div class="logo-area">
    <span class="logo-icon"></span>
    <span class="logo-text">AMARILO</span>
  </div>

  <!-- Badge "MUY PRONTO" -->
  <div class="badge">MUY PRONTO</div>

  <!-- Content -->
  <div class="content" style="bottom:${Math.round(height*0.08)}px">
    ${vars.PROJECT_NAME ? `<div class="project-name">${vars.PROJECT_NAME}</div>` : ''}
    ${vars.TAGLINE ? `<div class="tagline">${vars.TAGLINE}</div>` : ''}
    ${vars.AREAS ? `<div class="areas-line">Aptos desde ${vars.AREAS} + balcón</div>` : ''}
    ${vars.PRICE ? `
    <div class="price-box">
      <div class="price-label">Desde</div>
      <div class="price-value">${vars.PRICE}</div>
      ${vars.SMMLV ? `<div class="smmlv">${vars.SMMLV}</div>` : ''}
    </div>` : ''}
  </div>

  <div class="disclaimer">*Imagen de referencia. **Área privada. ***Sujeto a modificaciones. El valor final será el equivalente en pesos colombianos correspondiente a los SMMLV del año en el cual se otorgue la escritura pública de compraventa.</div>
</body>
</html>`
}
