#!/usr/bin/env python3
"""Independent read-only 2048 trace verifier. No imports of experiment game/solver code.
Reimplements Mulberry32 with explicit uint32 arithmetic and the game with lane merges.
Verifies public results and compact move sequences without loading model weights.
"""
import argparse, collections, datetime, hashlib, json, pathlib, re
MASK = 0xffffffff
class RNG:
    def __init__(self, seed): self.state, self.calls = seed, 0
    def next(self):
        self.calls += 1
        self.state = (self.state + 0x6d2b79f5) & MASK
        x = ((self.state ^ (self.state >> 15)) * (self.state | 1)) & MASK
        x = (x ^ (x + (((x ^ (x >> 7)) * (x | 61)) & MASK))) & MASK
        return ((x ^ (x >> 14)) & MASK) / 4294967296

def spawn(board, rng):
    empty = [i for i, v in enumerate(board) if v == 0]
    assert empty, 'Spawn attempted without empty cell'
    p, v = rng.next(), rng.next()
    board[empty[int(p * len(empty))]] = 2 if v < .9 else 4

def move(board, direction):
    result, reward = board[:], 0
    # Compose geometrical rows/columns in direction of travel; combine once per pair.
    for lane in range(4):
        if direction in (1,3): indices = list(range(lane*4, lane*4+4))
        else: indices = list(range(lane, 16, 4))
        if direction in (1,2): indices.reverse()
        nonzero = [board[i] for i in indices if board[i]]
        merged, k = [], 0
        while k < len(nonzero):
            val = nonzero[k]
            if k+1 < len(nonzero) and val == nonzero[k+1]:
                val *= 2; reward += val; k += 1
            merged.append(val); k += 1
        merged += [0] * (4-len(merged))
        for i,v in zip(indices, merged): result[i] = v
    return result, reward

def main():
    root=pathlib.Path(__file__).resolve().parent
    results=[json.loads(x) for x in (root/'results.jsonl').read_text().splitlines() if x]
    expected={(seed,mode) for seed in range(62002,62032) for mode in ('1','2','selective','3')}
    assert len(results)==120 and {(g['seed'],g['mode'])for g in results}==expected
    total,milestones=0,0
    for g in results:
        mode=g['mode'];trace=json.loads((root/'traces'/f"{g['seed']}.json").read_text())[mode]
        assert set(trace)<=set('0123')
        board=[0]*16;rng=RNG(g['seed']);spawn(board,rng);spawn(board,rng)
        score=0;events=[];hist=collections.Counter();td=heur=0
        def observe(n):
            for name,hit in [('first32768',max(board)>=32768),('second32768',board.count(32768)>=2),('first65536',max(board)>=65536)]:
                if hit and not any(e['name']==name for e in events):events.append({'name':name,'moves':n,'score':score,'board':board[:]})
        def decision():
            nonlocal td,heur
            if board.count(32768)>=2:heur+=1
            else:
                td+=1;ply=3 if mode=='selective' and board.count(0)<=1 and max(board)>=8192 else 2 if mode=='selective' else int(mode);hist[str(ply)]+=1
        observe(0)
        for n,d in enumerate(map(int,trace),1):
            assert max(board)<65536
            decision();new,reward=move(board,d);assert new!=board
            board=new;score+=reward;observe(n)
            if max(board)<65536:spawn(board,rng)
        if g['outcome']=='loss':decision()
        for key,value in {'finalBoard':board,'score':score,'moves':len(trace),'movesThisRun':len(trace),'rngCalls':rng.calls,'maxTile':max(board),'events':events,'actualPlyHistogram':dict(hist),'handedOff':any(e['name']=='second32768'for e in events)}.items():
            assert g[key]==value,(g['seed'],mode,key)
        assert g['cost']['td']['decisions']==td and g['cost']['heuristic']['decisions']==heur
        assert g['outcome']=='loss' and not g['censored'] and g['stopReason']=='no_legal_moves'
        assert all(move(board,d)[0]==board for d in range(4))
        total+=len(trace);milestones+=len(events)
    print(json.dumps({'passed':True,'games':len(results),'moves':total,'milestones':milestones,'naturalLosses':120},indent=2))
if __name__=='__main__':main()
