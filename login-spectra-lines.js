/* Spectra's login lines. Every "voiced" line has a clip in spectra-voice-lines/<id>.wav (made with login-voice-generator.html). */
window.SPECTRA_LOGIN = {
  idle: ["idle1", "idle2", "idle3", "idle4", "idle5", "idle6", "idle7", "idle8", "idle9"],   // ids from "voiced" below; rotates every few seconds and now speaks too
  late: "It's way too late. Log in and then go sleep!",
  voiced: {   // id: [text, mood]  (moods = the ones your spectra-voice function knows)
    pwfocus: ["I'm not looking! ...Really!", "shy"],
    caps:    ["Caps lock is on, you know. Seriously.", "annoyed"],
    wrong:   ["Tch. Wrong. Try again, baka.", "annoyed"],
    signup:  ["A newcomer? ...Fine. Welcome. I guess.", "shy"],
    forgot:  ["Forgot your password? Seriously? ...Fine. It happens.", "deadpan"],
    success: ["Fine. Welcome back. Don't make it weird.", "smug"],
    account: ["Back again? Go on, you're already in.", "deadpan"],
    poke1:   ["H-hey! Stop poking me!", "shocked"],
    poke2:   ["Don't touch the glass!", "annoyed"],
    poke3:   ["I can see you doing that, you know.", "smug"],
    poke4:   ["Hmph! Log in, don't poke.", "pout"],
    mad:     ["That's it! I'm telling the admins!", "grumpy"],
    late:    ["It's way too late. Log in and then go sleep!", "sleepy"],
    /* former text-only idle lines */
    idle1:   ["Hmph. You're late. Log in already.", "annoyed"],
    idle2:   ["Don't just stare at me. Type your password.", "annoyed"],
    idle3:   ["I-it's not like I was waiting for you or anything.", "shy"],
    idle4:   ["Use a strong password, baka.", "pout"],
    idle5:   ["Hurry up. My arms are getting tired holding this glass.", "grumpy"],
    idle6:   ["Google or Discord, whatever. Just pick one.", "deadpan"],
    idle7:   ["Don't share your password. Not even with me.", "smug"],
    idle8:   ["You're 13 or older, right? Rules are rules.", "deadpan"],
    idle9:   ["Typing slow? I'm not impatient. I'm NOT.", "annoyed"]
  },
  pokes: ["poke1", "poke2", "poke3", "poke4"]
};
