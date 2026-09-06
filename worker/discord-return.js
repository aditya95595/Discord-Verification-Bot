// AGENT 001 - Discord return helper
// Best-effort Android/app deep-link after verification.

export function getDiscordReturnScript() {
  return `
    function returnToDiscord(){
      var fallback='https://discord.com/app';
      try{ window.location.href='discord://'; }catch(e){}
      setTimeout(function(){
        if(!document.hidden){
          var b=document.createElement('a');
          b.href=fallback;
          b.textContent='RETURN TO DISCORD';
          b.className='btn';
          b.style.display='block';
          b.style.textDecoration='none';
          b.style.textAlign='center';
          document.querySelector('.card').appendChild(b);
        }
      },1800);
    }
  `;
}
