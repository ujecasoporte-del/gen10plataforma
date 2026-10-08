const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../inscripcion-config.js'),'utf8');
function config(active,pathname){
  const redirects=[];
  const window={location:{pathname,replace:url=>redirects.push(url)}};
  const document={currentScript:{src:'https://instituto.example/campus/inscripcion-config.js'},readyState:'loading',addEventListener(){},documentElement:{style:{setProperty(){}}}};
  vm.runInNewContext(source.replace('activo: false','activo: '+active),{window,document,URL});
  return {window,redirects};
}
test('Mantenimiento se aplica a todas las plataformas, sin bucle ni redirección cuando está desactivado',()=>{
  for(const page of ['index.html','gen10.html','home.html','matriculas.html','notas.html','inscripcion.html','registro-alumnos (2).html']){
    assert.equal(config(false,'/campus/'+page).redirects.length,0);
    assert.deepEqual(config(true,'/campus/'+page).redirects,['https://instituto.example/campus/mantenimiento.html']);
  }
  assert.equal(config(true,'/campus/mantenimiento.html').redirects.length,0);
  assert.ok(Object.isFrozen(config(false,'/campus/index.html').window.IFOBE_CONFIG.mantenimiento));
});
