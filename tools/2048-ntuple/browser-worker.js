/* MIT. The File is read only in this Worker; weights never leave the user's browser. */
'use strict';
importScripts('../2048-expectimax/expectimax2048.js', 'ntuple2048.js', 'browser-sha256.js');
let solver = null;
self.onmessage = async function(event) {
  const msg = event.data;
  try {
    if (msg.type === 'load') {
      solver = null;
      const spec = NTuple2048.MODEL_CATALOG['8x6'], file = msg.file;
      if (!(file instanceof Blob) || file.size !== spec.bytes) throw new Error('请选择转换后的 8x6patt.f32（512 MiB），不能直接加载原始 .w 或 JSON 文件。');
      if (new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] !== 4) throw new Error('当前设备不支持小端 Float32 权重。');
      // One final model buffer plus a small rolling read chunk, not File.arrayBuffer()+a full copy.
      const buffer = new ArrayBuffer(spec.bytes), output = new Uint8Array(buffer), hash = new ModelSHA256();
      const chunkSize = 4 * 1024 * 1024;
      for (let offset = 0; offset < spec.bytes; offset += chunkSize) {
        const bytes = new Uint8Array(await file.slice(offset, Math.min(offset+chunkSize, spec.bytes)).arrayBuffer());
        output.set(bytes, offset); hash.update(bytes);
        self.postMessage({type:'progress', id:msg.id, progress:(offset+bytes.length)/spec.bytes});
      }
      if (hash.hex() !== spec.sha256) throw new Error('权重 SHA-256 不匹配。请使用 prepare-model.js 转换固定版本的 8x6 模型。');
      const tables = spec.patterns.map((_,i)=>new Float32Array(buffer, i*16777216*4, 16777216));
      const model = new NTuple2048.NTupleModel(tables, spec.patterns);
      solver = new NTuple2048.NTupleSolver(model, {ply:2,target:32768,criticalSearch:true,criticalEmpty:1,criticalTile:8192});
      self.postMessage({type:'ready', id:msg.id, bytes:spec.bytes, sha256:spec.sha256});
    } else if (msg.type === 'move') {
      if (!solver) throw new Error('权重尚未加载。');
      // Only the current board crosses this boundary. No seed or future spawn/RNG state.
      self.postMessage({type:'move', id:msg.id, result:solver.chooseMove(msg.board)});
    }
  } catch(error) {
    self.postMessage({type:'error', id:msg.id, message:error && error.message ? error.message : String(error)});
  }
};
