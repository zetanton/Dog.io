import { Howl, Howler } from 'howler';

class AudioManager {
  private static instance: AudioManager;
  private titleMusic: Howl;
  private backgroundMusic: Howl;
  private natureSound: Howl;
  private biteSound: Howl;
  private chompSound: Howl;
  private yelpSound: Howl;
  private barkSounds: Howl[];
  private isMuted: boolean = false;

  private constructor() {
    // Title music
    this.titleMusic = new Howl({
      src: ['/audio/music/title.mp3'],
      loop: true,
      volume: 0.5,
      preload: true,
      onload: () => {},
      onloaderror: () => {}
    });

    // Background music for gameplay
    this.backgroundMusic = new Howl({
      src: ['/audio/music/background.mp3'],
      loop: true,
      volume: 0.4,
    });

    // Nature ambience
    this.natureSound = new Howl({
      src: ['/audio/music/nature.mp3'],
      loop: true,
      volume: 0.1,
    });

    // Bite sound (randomly choose between bite and chomp)
    this.biteSound = new Howl({
      src: ['/audio/sfx/bite_sound.mp3'],
      volume: 0.4,
    });

    this.chompSound = new Howl({
      src: ['/audio/sfx/chomp_sound.mp3'],
      volume: 0.4,
    });

    // Death sound
    this.yelpSound = new Howl({
      src: ['/audio/sfx/dog_yelp.mp3'],
      volume: 0.4,
    });

    // Bark sounds
    this.barkSounds = [
      new Howl({ src: ['/audio/sfx/bark (1).mp3'], volume: 0.4 }),
      new Howl({ src: ['/audio/sfx/bark (2).mp3'], volume: 0.4 }),
      new Howl({ src: ['/audio/sfx/bark (3).mp3'], volume: 0.4 }),
      new Howl({ src: ['/audio/sfx/bark (4).mp3'], volume: 0.4 }),
      new Howl({ src: ['/audio/sfx/bark (5).mp3'], volume: 0.4 }),
      new Howl({ src: ['/audio/sfx/bark (6).mp3'], volume: 0.4 }),
      new Howl({ src: ['/audio/sfx/bark.mp3'], volume: 0.4 }),
    ];
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public playTitleMusic() {
    this.stopGameMusic();
    if (this.titleMusic.state() === 'loaded') {
      this.titleMusic.play();
    } else {
      this.titleMusic.once('load', () => {
        this.titleMusic.play();
      });
    }
  }

  public stopTitleMusic() {
    this.titleMusic.stop();
  }

  public playGameMusic() {
    this.stopTitleMusic();
    this.backgroundMusic.play();
    this.natureSound.play();
  }

  public stopGameMusic() {
    this.backgroundMusic.stop();
    this.natureSound.stop();
  }

  public playBiteSound() {
    // Randomly choose between bite and chomp sound
    if (Math.random() < 0.5) {
      this.biteSound.play();
    } else {
      this.chompSound.play();
    }
  }

  public playYelpSound() {
    this.yelpSound.play();
  }

  public playBarkSound() {
    // Create a new array each time to avoid potential state issues
    const availableSounds = [...this.barkSounds];
    // Get a truly random index and remove that sound from the available ones
    const randomIndex = Math.floor(Math.random() * availableSounds.length);
    availableSounds[randomIndex].play();
  }

  public toggleMute() {
    this.isMuted = !this.isMuted;
    Howler.mute(this.isMuted);
    return this.isMuted;
  }

  public isSoundMuted(): boolean {
    return this.isMuted;
  }
}

export default AudioManager; 