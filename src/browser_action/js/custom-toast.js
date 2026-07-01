/*
 * Custom Toast — drop-in replacement for toastr.
 * Exposes the same public API used by browser_action.js:
 *   toastr.options = {...}
 *   toastr.success(message, title)
 *   toastr.info(message, title)
 *   toastr.error(message, title)
 *   toastr.clear()
 * so no logic in browser_action.js needs to change.
 */
(function () {
  var ICONS = {
    success: '<i class="fas fa-circle-check"></i>',
    info: '<i class="fas fa-circle-info"></i>',
    error: '<i class="fas fa-circle-exclamation"></i>',
  };

  var container = null;

  function ensureContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.createElement('div');
    container.className = 'ct-container';
    document.body.appendChild(container);
    return container;
  }

  function clear() {
    var c = ensureContainer();
    var toasts = c.querySelectorAll('.ct-toast');
    toasts.forEach(function (t) {
      removeToast(t);
    });
  }

  function removeToast(toast) {
    if (!toast || toast.dataset.removing) return;
    toast.dataset.removing = 'true';
    toast.classList.remove('ct-in');
    toast.classList.add('ct-out');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 280);
  }

  function show(type, message, title) {
    var c = ensureContainer();
    var opts = window.toastr.options || {};
    var timeOut = parseInt(opts.timeOut, 10) || 4000;

    var toast = document.createElement('div');
    toast.className = 'ct-toast ct-' + type;

    var bar = document.createElement('div');
    bar.className = 'ct-progress';
    bar.style.animationDuration = timeOut + 'ms';

    var iconWrap = document.createElement('div');
    iconWrap.className = 'ct-icon';
    iconWrap.innerHTML = ICONS[type] || ICONS.info;

    var body = document.createElement('div');
    body.className = 'ct-body';

    if (title) {
      var titleEl = document.createElement('div');
      titleEl.className = 'ct-title';
      titleEl.textContent = title;
      body.appendChild(titleEl);
    }

    var msgEl = document.createElement('div');
    msgEl.className = 'ct-message';
    msgEl.textContent = message || '';
    body.appendChild(msgEl);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'ct-close';
    closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
    closeBtn.addEventListener('click', function () {
      removeToast(toast);
    });

    toast.appendChild(iconWrap);
    toast.appendChild(body);
    toast.appendChild(closeBtn);
    toast.appendChild(bar);

    c.appendChild(toast);

    // trigger enter animation on next frame
    requestAnimationFrame(function () {
      toast.classList.add('ct-in');
    });

    var autoTimer = setTimeout(function () {
      removeToast(toast);
    }, timeOut);

    toast.addEventListener('mouseenter', function () {
      clearTimeout(autoTimer);
      bar.style.animationPlayState = 'paused';
    });
    toast.addEventListener('mouseleave', function () {
      bar.style.animationPlayState = 'running';
      autoTimer = setTimeout(function () {
        removeToast(toast);
      }, 1200);
    });
  }

  window.toastr = {
    options: {},
    success: function (message, title) {
      show('success', message, title);
    },
    info: function (message, title) {
      show('info', message, title);
    },
    error: function (message, title) {
      show('error', message, title);
    },
    clear: clear,
  };
})();
