// PCM is sent only to the local recognition worker, never to a server.
class LocalVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.position = 0;
    this.port.onmessage = event => {
      if (event.data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }); }
    };
  }
  flush() {
    if (!this.position) return;
    const samples = this.samples.slice(0, this.position);
    this.port.postMessage({ samples }, [samples.buffer]);
    this.position = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.samples[this.position++] = channel[i];
        if (this.position === this.samples.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('local-voice-capture', LocalVoiceCapture);
