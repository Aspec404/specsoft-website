/* Spectra's login lines. "voiced" lines have a clip in assets/voice/<id>.wav (made with login-voice-generator.html). */
window.SPECTRA_LOGIN = {
  idle: [   // text only, rotates every few seconds (never spoken)
    "Hmph. You're late. Log in already.",
    "Don't just stare at me. Type your password.",
    "I-it's not like I was waiting for you or anything.",
    "Use a strong password, baka.",
    "Hurry up. My arms are getting tired holding this glass.",
    "Google or Discord, whatever. Just pick one.",
    "Don't share your password. Not even with me.",
    "You're 13 or older, right? Rules are rules.",
    "Typing slow? I'm not impatient. I'm NOT."
  ],
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
    late:    ["It's way too late. Log in and then go sleep!", "sleepy"]
  },
  pokes: ["poke1", "poke2", "poke3", "poke4"]
};
