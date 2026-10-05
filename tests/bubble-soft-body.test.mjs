import test from 'node:test';
import assert from 'node:assert/strict';
import {squeeze,recover,deformation} from '../src/markets/crypto/bubbles/soft-body.js';
import {BubbleField} from '../src/markets/crypto/bubbles/field.js';
function field(nodes,extra={}){
 const scene=Object.create(BubbleField.prototype);
 Object.assign(scene,{width:400,height:450,reduced:{matches:false},paused:false,zoom:1,panX:0,panY:0,pointers:new Map(),nodes:nodes.map((n,i)=>({r:30,target:30,vx:0,vy:0,seed:i+1,symbol:String(i),...n})),...extra});return scene;
}
test('a contact compresses along the contact normal, conserves area and recovers after release',()=>{
 const n={};squeeze(n,1,0,.12);assert.equal(deformation(n).sx,1);recover(n);let d=deformation(n);
 assert(Math.abs(d.angle-Math.PI/2)<1e-9);assert(d.sx>1&&d.sy<1);assert(Math.abs(d.sx*d.sy-1)<1e-10);
 for(let i=0;i<180;i++)recover(n);d=deformation(n);assert(Math.abs(d.sx-1)<.0002);assert(Math.abs(d.sy-1)<.0002);
 const corner={};for(let i=0;i<1000;i++){squeeze(corner,1,1,100);recover(corner,2);}
 d=deformation(corner);assert(d.sx<=Math.exp(.24));assert(d.sy>=Math.exp(-.24));assert(Number.isFinite(d.angle));
});
test('pressure and impulse states stay finite for empty and invalid inputs',()=>{
 const n={};squeeze(n,0,0,1);squeeze(n,1,0,NaN);squeeze(n,Infinity,0,1);squeeze(n,NaN,1,1);assert.deepEqual(deformation(n),{angle:0,sx:1,sy:1});recover(n,.2);recover(n,NaN);assert(Object.values(n).every(Number.isFinite));
});
test('contact target eases in without a snap and does not oscillate on release',()=>{
 const n={};let previous=0;
 for(let i=0;i<30;i++){squeeze(n,1,0,.06);recover(n);const x=Math.abs(n.strainX);assert(x-previous<.02);assert(x<=.17);previous=x;}
 for(let i=0;i<180;i++){recover(n);assert(n.strainX<=.001);}
 assert(Math.abs(n.strainX)<.001);
});
test('critical spring follows the same timed contact at 30, 60 and 120 Hz',()=>{
 const states=[2,1,.5].map(dt=>{const n={};for(let time=0;time<8;time+=dt){n.pressureX=-.12;recover(n,dt);}return n;});
 for(const n of states){assert(Math.abs(n.strainX-states[0].strainX)<1e-10);assert(Math.abs(n.strainVX-states[0].strainVX)<1e-10);}
});
test('collision travel is consistent across 30, 60, 120 and 144 Hz',()=>{
 const results=[30,60,120,144].map(hz=>{const f=field([{x:100,y:200,vx:3},{x:175,y:200,vx:-1}]);for(let i=0;i<hz;i++)f.advance(60/hz,i*1000/hz);return f.nodes;});
 for(const nodes of results)for(let i=0;i<nodes.length;i++){assert(Math.hypot(nodes[i].x-results[0][i].x,nodes[i].y-results[0][i].y)<.4);assert(Number.isFinite(nodes[i].vx));assert(Math.abs(nodes[i].vx)<3);}
});
test('drag preserves grab offset and pointer sampling cannot teleport a bubble',()=>{
 const f=field([{x:100,y:150}]),n=f.nodes[0];f.canvas={getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture(){}};f.paint=f.run=()=>{};
 const event=(x,y)=>({pointerId:1,pointerType:'mouse',button:0,clientX:x,clientY:y,preventDefault(){}});
 f.down(event(120,150));f.move(event(160,150));assert.equal(n.x,100);assert.deepEqual(f.drag.target,{x:140,y:150});
 for(let i=0;i<100;i++)f.move(event(160,150));assert.equal(n.x,100);
 f.advanceDrag(.5);assert(n.x>100&&n.x<140);assert(n.x-100<=10.5);
 for(let i=0;i<30;i++)f.advanceDrag(.5);assert(Math.abs(n.x-140)<.01);
});
test('held bubbles cannot tunnel through a neighbour pinned to a wall',()=>{
 const f=field([{x:220,y:200},{x:369,y:200}],{paused:true}),held=f.nodes[0];f.drag={node:held,moved:true,target:{x:390,y:200},wallX:21};
 for(let i=0;i<120;i++){f.advance(1,i*16.67);assert(held.x<f.nodes[1].x);assert(f.nodes[1].x-held.x>45);}
 assert(Math.abs(held.strainX)>.01);assert(f.nodes[1].x+f.extents(f.nodes[1]).x<=399.001);
});
test('paused wall pressure recovers smoothly without clipping the growing shell',()=>{
 const f=field([{x:100,y:200}],{paused:true}),n=f.nodes[0];f.drag={node:n,moved:true,target:{x:2,y:200},wallX:29};
 for(let i=0;i<20;i++)f.advance(1,0);assert(n.strainX<-.035);assert(n.x-f.extents(n).x>=.999);
 f.drag=null;for(let i=0;i<60;i++){f.advance(1,0);assert(n.x-f.extents(n).x>=.999);}
 assert(Math.abs(n.strainX)<.001);assert(n.x>=n.r+.999);
});
test('wall reflection never flips a bubble already moving away from the wall',()=>{
 const f=field([{x:20,y:100,vx:3},{x:380,y:220,vx:-3}]);f.constrainBounds();assert.equal(f.nodes[0].vx,3);assert.equal(f.nodes[1].vx,-3);
});
test('reduced motion keeps direct drag and collision interaction without deformation',()=>{
 const f=field([{x:100,y:200},{x:180,y:200}],{paused:true,reduced:{matches:true}}),n=f.nodes[0];f.drag={node:n,moved:true,target:{x:150,y:200},wallX:0};
 f.advance(1,0);assert(n.x>100);assert(f.nodes.every(row=>Math.hypot(row.strainX,row.strainY)===0));
});
test('paint deforms only the shell and draws labels after restoring its transform',()=>{
 const calls=[],ctx={clearRect(){},save(){calls.push('save');},restore(){calls.push('restore');},translate(){},scale(){},rotate(){calls.push('rotate');},drawImage(image){calls.push(image);}};
 const f=field([{x:100,y:200,strainX:.12,sprite:'shell',labelSprite:'label'}],{ctx});f.paint();
 assert.deepEqual(calls,['save','save','rotate','rotate','shell','restore','label','restore']);
});
