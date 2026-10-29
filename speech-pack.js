/* Locally bundled original recordings, with native Japanese voice fallback. */
(() => {
  const nativeSpeak=speak;
  let clips={},normalized={},active=null,sequence=0;
  const normalize=s=>String(s||'').replace(/[\s。？?！!、,]/g,'');
  const ready=fetch('audio/manifest.json').then(r=>{if(!r.ok)throw Error('audio manifest');return r.json();}).then(data=>{clips=data.clips||{};Object.entries(clips).forEach(([k,v])=>{normalized[normalize(k)]=v;});return true;}).catch(()=>false);
  window.malmunAudioReady=ready;
  window.stopMalmunAudio=()=>{sequence++;if(active){active.pause();active=null;}try{speechSynthesis.cancel();}catch{}};
  function notice(msg){if(typeof toast==='function')toast(msg);}
  function fallback(text,opt){if(typeof speechSynthesis==='undefined'){notice('이 표현의 음성을 재생하려면 일본어 TTS를 지원하는 브라우저가 필요해요.');return;}
    const voices=speechSynthesis.getVoices();if(voices.length&&!voices.some(v=>v.lang?.toLowerCase().startsWith('ja'))){notice('새 예문은 기기의 일본어 음성으로 읽어요. 설정에서 일본어 TTS를 추가해 주세요.');return;}
    nativeSpeak(text,opt);
  }
  speak=function(kr,opt){
    if(!S.voice||S.ch==='ch0'||kr==null)return;
    const text=toJP(kr),key=normalize(text);if(!/[\u3040-\u30ff\u3400-\u9fff]/.test(text))return;
    window.stopMalmunAudio();const current=sequence;
    const play=()=>{if(current!==sequence||!S.voice)return;const path=clips[text]||normalized[key];if(!path){fallback(kr,opt);return;}
      active=new Audio(path);active.playbackRate=opt&&opt.slow?0.9:1;active.preload='auto';
      active.play().catch(()=>{if(current===sequence&&S.voice)fallback(kr,opt);});
    };
    if(Object.keys(clips).length)play();else ready.then(play);
  };
  document.getElementById('voicebtn').addEventListener('click',()=>{if(!S.voice)window.stopMalmunAudio();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)window.stopMalmunAudio();});
})();
