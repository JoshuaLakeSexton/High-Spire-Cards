(function (global) {
  function sanitizeUrl(value) {
    if (!value || typeof value !== 'string') {
      return '';
    }

    try {
      const url = new URL(value, global.location.origin);
      return url.toString();
    } catch (_err) {
      return '';
    }
  }

  function createElement(tag, className) {
    const el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    return el;
  }

  function createEmbedFrame(embedUrl, title) {
    const iframe = createElement('iframe', 'videoFrame');
    iframe.src = embedUrl;
    iframe.title = title || 'High Spire introduction video';
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    return iframe;
  }

  function createVideoPlayer(config) {
    const wrap = createElement('div', 'videoPlayerWrap');
    const video = createElement('video', 'videoFrame');
    video.controls = true;
    video.preload = 'metadata';

    if (config.poster) {
      video.poster = config.poster;
    }

    if (config.videoSrc) {
      const source = document.createElement('source');
      source.src = config.videoSrc;
      source.type = config.videoType || 'video/mp4';
      video.appendChild(source);
    }

    video.setAttribute('aria-label', config.title || 'High Spire introduction video');

    const control = createElement('button', 'videoCenterControl');
    control.type = 'button';

    function syncControlState() {
      const playing = !video.paused && !video.ended;
      control.textContent = playing ? 'Pause' : 'Play';
      control.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
      control.setAttribute('aria-pressed', playing ? 'true' : 'false');
    }

    control.addEventListener('click', function () {
      if (video.paused || video.ended) {
        video.play().catch(function () {});
      } else {
        video.pause();
      }
    });

    video.addEventListener('play', syncControlState);
    video.addEventListener('pause', syncControlState);
    video.addEventListener('ended', syncControlState);
    video.addEventListener('loadedmetadata', syncControlState);

    wrap.appendChild(video);
    wrap.appendChild(control);
    syncControlState();
    return wrap;
  }

  function createPosterOnly(config) {
    const container = createElement('div', 'videoPosterOnly');

    if (config.poster) {
      container.style.backgroundImage = "url('" + config.poster.replace(/'/g, '%27') + "')";
    }

    const playBadge = createElement('div', 'videoPosterBadge');
    playBadge.textContent = 'Video coming soon';
    container.appendChild(playBadge);

    if (config.description) {
      const helper = createElement('p', 'videoPosterHelp');
      helper.textContent = config.description;
      container.appendChild(helper);
    }

    return container;
  }

  function renderVideoBlock(target, options) {
    if (!target) {
      throw new Error('Video block target is required.');
    }

    const config = {
      title:
        options && Object.prototype.hasOwnProperty.call(options, 'title')
          ? String(options.title || '')
          : '',
      description: options && options.description ? String(options.description) : '',
      videoSrc: sanitizeUrl(options && options.videoSrc),
      videoType: options && options.videoType ? String(options.videoType) : 'video/mp4',
      embedUrl: sanitizeUrl(options && options.embedUrl),
      poster: sanitizeUrl(options && options.poster),
    };

    const shell = createElement('section', 'videoShell');
    if (config.title) {
      const heading = createElement('h2', 'videoTitle');
      heading.textContent = config.title;
      shell.appendChild(heading);
    }

    if (config.description) {
      const text = createElement('p', 'videoDescription');
      text.textContent = config.description;
      shell.appendChild(text);
    }

    let playerNode;
    if (config.embedUrl) {
      playerNode = createEmbedFrame(config.embedUrl, config.title);
    } else if (config.videoSrc) {
      playerNode = createVideoPlayer(config);
    } else {
      playerNode = createPosterOnly(config);
    }

    shell.appendChild(playerNode);

    target.innerHTML = '';
    target.appendChild(shell);
  }

  global.HighSpireVideo = {
    renderVideoBlock: renderVideoBlock,
  };
})(window);
