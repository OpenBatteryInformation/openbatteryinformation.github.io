/* Reveal-on-scroll entrance animations (ui-flashy branch, exploratory).
   Adds a staggered fade/slide-up to page blocks. Everything stays visible
   if IntersectionObserver is missing or the user prefers reduced motion. */
(function () {
  var SELECTORS = [
    '.hero',
    '.feature-card',
    '.step',
    '.card',
    '.warning',
    '.faq',
    '.wizard-card',
    '.flash-card',
    '.test-group',
    '.tool-header',
    '.uploader-header'
  ].join(', ');

  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var els = document.querySelectorAll(SELECTORS);
  if (!els.length) return;

  document.documentElement.classList.add('js-reveal');
  els.forEach(function (el) { el.classList.add('reveal'); });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      var delay = 0;
      if (el.dataset.revealDelay) {
        delay = parseInt(el.dataset.revealDelay, 10) || 0;
      } else {
        var parent = el.parentElement;
        if (parent) {
          var idx = Array.prototype.indexOf.call(parent.children, el);
          delay = Math.min(idx * 70, 490);
        }
      }
      if (delay) el.style.transitionDelay = delay + 'ms';
      el.classList.add('revealed');
      io.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  els.forEach(function (el) { io.observe(el); });
})();
