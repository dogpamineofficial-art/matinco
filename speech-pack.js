/* Pre-rendered Japanese speech. No text or microphone audio is sent to a TTS service. */
(() => {
  'use strict';
  const PREF_KEY='malmun_audio_preferences_v1',prefs={speed:1,repeat:1};
  try{const saved=JSON.parse(localStorage.getItem(PREF_KEY)||'{}');if([0.8,1,1.1].includes(saved.speed))prefs.speed=saved.speed;if([1,2].includes(saved.repeat))prefs.repeat=saved.repeat;}catch{}
  let clips={},normalized={},canonical={},overrides={},pronunciation={},active=null,sequence=0,repeatTimer=null,last=null,panel=null;
  const normalize=s=>String(s||'').normalize('NFKC').replace(/[\s。！!、,.]/g,'').replace(/？/g,'?');
  const state=window.malmunAudioState={status:'idle',text:'',source:'',count:0,voice:'',speed:prefs.speed,repeat:prefs.repeat};
  function announce(){Object.assign(state,{speed:prefs.speed,repeat:prefs.repeat});window.dispatchEvent(new CustomEvent('malmun:audio',{detail:{...state}}));render();}
  function notice(msg){if(typeof toast==='function')toast(msg);}
  const ready=fetch('audio/manifest.json').then(r=>{if(!r.ok)throw Error('audio manifest');return r.json();}).then(data=>{
    clips=data.clips||{};overrides=data.sourceOverrides||{};pronunciation=data.pronunciationOverrides||{};Object.assign(JP,overrides);
    Object.entries(clips).forEach(([k,v])=>{normalized[normalize(k)]=v;canonical[normalize(k)]=k;});
    Object.entries(data.aliases||{}).forEach(([alias,key])=>{if(clips[key]){normalized[normalize(alias)]=clips[key];canonical[normalize(alias)]=key;}});
    state.count=new Set(Object.values(clips)).size;state.voice=data.credit?[data.credit,data.voiceName].filter(Boolean).join(' '):String(data.voice||'');announce();return true;
  }).catch(()=>false);
  window.malmunAudioReady=ready;
  function japanese(input){const raw=String(input??'').replace(/<[^>]+>/g,'').split(' = ')[0].trim();return overrides[raw]||toJP(raw);}
  window.resolveMalmunAudio=input=>{const text=japanese(input),key=canonical[normalize(text)]||text;return {text,path:clips[text]||normalized[normalize(text)]||null,reading:pronunciation[key]||key};};
  function ensurePanel(){
    if(panel)return;
    panel=document.createElement('section');panel.className='audio-player';panel.setAttribute('aria-label','일본어 발음 재생');panel.hidden=true;
    panel.innerHTML='<div class="audio-line"><div class="audio-copy"><span class="audio-status" role="status"></span><p class="audio-japanese" lang="ja"></p></div><button class="audio-dismiss" aria-label="음성 재생창 닫기">×</button></div><div class="audio-controls"><button class="audio-again">다시 듣기</button><button class="audio-stop">멈춤</button><label><span class="sr-only">읽기 속도</span><select class="audio-speed" aria-label="읽기 속도"><option value="0.8">천천히 · 0.8배</option><option value="1">보통 · 1배</option><option value="1.1">빠르게 · 1.1배</option></select></label><button class="audio-repeat" aria-pressed="false">두 번 듣기</button></div>';
    document.body.append(panel);
    panel.querySelector('.audio-again').onclick=()=>{if(last){if(!S.voice){S.voice=true;save();if(typeof syncVoice==='function')syncVoice();}speak(last.input,last.options);}};
    panel.querySelector('.audio-stop').onclick=()=>window.stopMalmunAudio();
    panel.querySelector('.audio-dismiss').onclick=()=>{window.stopMalmunAudio();panel.hidden=true;document.body.classList.remove('has-audio-player');};
    panel.querySelector('.audio-speed').onchange=e=>window.setMalmunAudioPreferences({speed:Number(e.target.value)});
    panel.querySelector('.audio-repeat').onclick=()=>window.setMalmunAudioPreferences({repeat:prefs.repeat===1?2:1});
  }
  function render(){
    if(!panel)return;
    panel.querySelector('.audio-japanese').textContent=state.text;
    const labels={loading:'음성 준비 중',playing:'일본어 듣는 중',waiting:'한 번 더 들어보세요',ended:'직접 소리 내어 말해보세요',stopped:'다시 듣기로 이어갈 수 있어요',error:'음성을 재생하지 못했어요',idle:'일본어 발음'};
    panel.querySelector('.audio-status').textContent=(labels[state.status]||labels.idle)+(state.source==='device'?' · 기기 음성':'');
    panel.querySelector('.audio-speed').value=String(prefs.speed);
    panel.querySelector('.audio-repeat').setAttribute('aria-pressed',String(prefs.repeat===2));
    panel.querySelector('.audio-stop').disabled=!['loading','playing','waiting'].includes(state.status);
  }
  window.setMalmunAudioPreferences=function(values){
    if([0.8,1,1.1].includes(values.speed))prefs.speed=values.speed;
    if([1,2].includes(values.repeat))prefs.repeat=values.repeat;
    try{localStorage.setItem(PREF_KEY,JSON.stringify(prefs));}catch{}
    if(active)active.playbackRate=prefs.speed;
    if(prefs.repeat===1&&repeatTimer){clearTimeout(repeatTimer);repeatTimer=null;state.status='ended';}
    announce();
  };
  window.stopMalmunAudio=function(){
    sequence++;clearTimeout(repeatTimer);repeatTimer=null;
    if(active){active.onended=null;active.onerror=null;active.pause();active=null;}
    try{speechSynthesis.cancel();}catch{}
    state.status='stopped';announce();
  };
  function finish(current,iteration,playAgain){
    if(current!==sequence)return;
    active=null;
    if(prefs.repeat===2&&iteration===1&&!document.hidden&&S.voice){state.status='waiting';announce();repeatTimer=setTimeout(()=>{repeatTimer=null;if(current===sequence&&S.voice&&!document.hidden)playAgain(2);},1200);}
    else{state.status='ended';announce();}
  }
  function fail(message){state.status='error';announce();notice(message);}
  function deviceSpeak(text,current,iteration){
    if(current!==sequence)return;
    if(typeof speechSynthesis==='undefined')return fail('음성이 저장되어 있지 않아요. 인터넷에 연결한 뒤 다시 들어보세요.');
    const voices=speechSynthesis.getVoices().filter(v=>/^ja([-_]|$)/i.test(v.lang));
    if(!voices.length)return fail('이 문장의 음성을 재생하지 못했어요. 인터넷 연결과 일본어 음성 설정을 확인해 주세요.');
    const voice=voices.find(v=>/nanami|natural|premium|enhanced/i.test(v.name))||voices[0];
    const utterance=new SpeechSynthesisUtterance(text);utterance.lang='ja-JP';utterance.voice=voice;utterance.rate=prefs.speed;utterance.pitch=1;
    state.source='device';state.status='playing';announce();
    utterance.onend=()=>finish(current,iteration,n=>deviceSpeak(text,current,n));
    utterance.onerror=e=>{if(current===sequence&&e.error!=='canceled'&&e.error!=='interrupted')fail('재생이 멈췄어요. 다시 듣기를 눌러 주세요.');};
    speechSynthesis.speak(utterance);
  }
  speak=function(input,options){
    if(!S.voice||S.ch==='ch0'||input==null)return;
    window.stopMalmunAudio();const current=sequence;
    const start=()=>{
      if(current!==sequence||!S.voice)return;
      const {text,path,reading}=window.resolveMalmunAudio(input);
      // Unknown Korean fragments must never become partial Japanese examples.
      if(!/[\u3040-\u30ff\u3400-\u9fff]/.test(text)||/[\uac00-\ud7af]/.test(text))return notice('이 표현의 일본어 발음을 아직 준비하지 못했어요.');
      last={input,options};state.text=text;state.status='loading';state.source=path?'pack':'device';ensurePanel();panel.hidden=false;document.body.classList.add('has-audio-player');announce();
      let repeatedClip=null;
      const play=iteration=>{
        if(current!==sequence||!S.voice)return;
        if(!path){deviceSpeak(reading,current,iteration);return;}
        // Reuse the user-started media element for Safari repeat playback.
        const clip=repeatedClip||(repeatedClip=new Audio(path));active=clip;clip.preload='auto';clip.playbackRate=prefs.speed;clip.preservesPitch=true;clip.currentTime=0;
        clip.onended=()=>finish(current,iteration,play);
        clip.play().then(()=>{if(current===sequence){state.status='playing';announce();}}).catch(error=>{
          if(current!==sequence)return;
          active=null;
          if(error.name==='NotAllowedError')fail('다시 듣기를 눌러 음성을 시작해 주세요.');
          else deviceSpeak(reading,current,iteration);
        });
      };
      play(1);
    };
    if(Object.keys(clips).length)start();else ready.then(start);
  };
  document.getElementById('voicebtn').addEventListener('click',()=>{if(!S.voice)window.stopMalmunAudio();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)window.stopMalmunAudio();});
  window.addEventListener('pagehide',()=>window.stopMalmunAudio());
})();
