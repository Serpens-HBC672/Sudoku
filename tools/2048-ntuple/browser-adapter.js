/* MIT. Browser file/Worker lifecycle plus the drafting game's exponent-tile adapter. */
(function(root, factory) {
  'use strict';
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.NTupleBrowser=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DIRECTIONS=Object.freeze(['up','right','down','left']);
  const scriptURL=typeof document!=='undefined' && document.currentScript ? document.currentScript.src : null;
  function boardFromTiles(tiles) {
    const board=new Array(16).fill(0), occupied=new Set();
    for(const t of tiles){
      if(!Number.isInteger(t.r)||!Number.isInteger(t.c)||t.r<0||t.r>3||t.c<0||t.c>3||!Number.isInteger(t.exp)||t.exp<1||t.exp>52)throw new RangeError('Invalid on-screen tile.');
      const i=t.r*4+t.c;if(occupied.has(i))throw new Error('Duplicate tile position.');occupied.add(i);board[i]=2**t.exp;
    }
    return board;
  }
  function directionName(direction){
    if(direction===null)return null;
    if(!Number.isInteger(direction)||direction<0||direction>3)throw new RangeError('Invalid solver direction.');
    return DIRECTIONS[direction];
  }
  function createClient(options={}) {
    const createWorker=options.createWorker || (()=>new Worker(new URL('browser-worker.js',scriptURL)));
    const notify=options.onState || (()=>{});
    let worker=null, sequence=0, pending=null, loadId=0, timer=null;
    let state={status:'empty',progress:0,message:'未加载权重'};
    function publish(next){state=Object.assign({},state,next);notify(Object.assign({},state));}
    function clearTimer(){clearTimeout(timer);timer=null;}
    function cancel(){if(pending){pending.resolve({cancelled:true});pending=null;clearTimer();}}
    function kill(){cancel();clearTimer();if(worker)worker.terminate();worker=null;loadId=0;}
    function fail(message){kill();publish({status:'error',message,progress:0});}
    function watchdog(){clearTimer();timer=setTimeout(()=>fail('后台线程长时间无响应；请重新加载权重，或切换原有启发式。'),60000);}
    function load(file){
      kill();
      if(!file || file.size!==536870912){publish({status:'error',message:'请选择转换后的 8x6patt.f32（512 MiB）；原始 .w 和 JSON 不能直接加载。',progress:0});return;}
      publish({status:'loading',progress:0,message:'正在本地读取并校验权重…'});
      let w;
      try{w=createWorker();worker=w;}catch(error){fail('无法启动后台线程。请通过 HTTP(S) 打开页面；仍可使用原有启发式。');return;}
      loadId=++sequence;
      w.onmessage=event=>{
        if(worker!==w)return;
        const m=event.data;
        if(m.type==='progress' && m.id===loadId){publish({progress:m.progress});watchdog();}
        else if(m.type==='ready' && m.id===loadId){clearTimer();publish({status:'ready',progress:1,message:'8x6 权重已就绪 · SHA-256 已验证'});}
        else if(m.type==='move' && pending && m.id===pending.id){
          const req=pending;pending=null;clearTimer();
          try{req.resolve(Object.assign({},m.result,{dir:directionName(m.result.direction),depth:m.result.actualPly,mode:'worker',engine:'td8'}));}
          catch(error){req.resolve({cancelled:true});fail(error.message);}
        } else if(m.type==='error' && (m.id===loadId || (pending && m.id===pending.id)))fail(m.message);
      };
      w.onerror=event=>{if(event.preventDefault)event.preventDefault();if(worker===w)fail('权重线程启动或运行失败。请确认相邻脚本存在、通过 HTTP(S) 打开，并留出足够内存。');};
      w.onmessageerror=()=>{if(worker===w)fail('后台线程消息读取失败，请重新选择权重。');};
      watchdog();
      try{w.postMessage({type:'load',id:loadId,file});}catch(error){fail(error.message);}
    }
    function ask(board){
      cancel();
      if(state.status!=='ready'||!worker)return Promise.resolve({cancelled:true});
      return new Promise(resolve=>{pending={id:++sequence,resolve};watchdog();try{worker.postMessage({type:'move',id:pending.id,board:board.slice()});}catch(error){fail(error.message);}});
    }
    function unload(){kill();publish({status:'empty',progress:0,message:'未加载权重'});}
    return {load,ask,cancel,unload,get state(){return Object.assign({},state);}};
  }
  return Object.freeze({boardFromTiles,directionName,createClient,DIRECTIONS});
});
