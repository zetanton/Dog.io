import { Howl, Howler } from 'howler';

class AudioManager {
  private static instance: AudioManager;
  private titleMusic: Howl;
  private backgroundMusic: Howl;
  private natureSound: Howl;
  private biteSound: Howl;
  private chompSound: Howl;
  private yelpSound: Howl;
  private isMuted: boolean = false;

  private constructor() {
    // Title music
    this.titleMusic = new Howl({
      src: ['/audio/music/title.mp3'],
      loop: true,
      volume: 0.5,
      preload: true,
      onload: () => {
        console.log('Title music loaded successfully');
      },
      onloaderror: (_: any, error: any) => {
        console.error('Error loading title music:', error);
      }
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
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public playTitleMusic() {
    console.log('Attempting to play title music');
    this.stopGameMusic();
    if (this.titleMusic.state() === 'loaded') {
      this.titleMusic.play();
      console.log('Title music started playing');
    } else {
      console.log('Title music not loaded yet, waiting...');
      this.titleMusic.once('load', () => {
        this.titleMusic.play();
        console.log('Title music started playing after load');
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