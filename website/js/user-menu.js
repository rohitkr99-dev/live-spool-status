/*
 * Shared "logged in as / logout" widget.
 *
 * Usage: drop `<div class="user-menu" id="user-menu"></div>` into a
 * page's header, then include this script after firebase-config.js
 * and auth-guard.js. It builds the avatar trigger, and portals the
 * dropdown panel to <body> so it always renders on top - it can
 * never be clipped by an ancestor's `overflow: hidden` (e.g. the
 * .topbar corner flourish) or trapped inside another element's
 * stacking context.
 */
(function () {

  function initials(email) {
    if (!email) return "?";
    return email.charAt(0).toUpperCase();
  }

  function buildMenu(mount) {

    mount.classList.add("user-menu");
    mount.innerHTML =
      '<button type="button" class="user-menu__trigger" id="user-menu-trigger" ' +
      'aria-haspopup="true" aria-expanded="false" title="Account">' +
      '<span id="user-menu-initial">?</span>' +
      "</button>";

    var trigger = mount.querySelector("#user-menu-trigger");
    var initialEl = mount.querySelector("#user-menu-initial");

    var dropdown = document.createElement("div");
    dropdown.className = "user-menu__dropdown";
    dropdown.setAttribute("role", "menu");
    dropdown.innerHTML =
      '<div class="user-menu__header">' +
      '<span class="user-menu__label">Signed in as</span>' +
      '<span class="user-menu__email" id="user-menu-email">&mdash;</span>' +
      "</div>" +
      '<div class="user-menu__divider"></div>' +
      '<button type="button" class="user-menu__item" id="user-menu-logout" role="menuitem">' +
      '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">' +
      '<path d="M8 4H5.5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5.5 16H8M13 13l3-3-3-3M16 10H7.5" ' +
      'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>" +
      "<span>Logout</span>" +
      "</button>";
    document.body.appendChild(dropdown);

    var emailEl = dropdown.querySelector("#user-menu-email");
    var logoutBtn = dropdown.querySelector("#user-menu-logout");

    var isOpen = false;

    function position() {
      var rect = trigger.getBoundingClientRect();
      var gutter = 8;
      dropdown.style.top = Math.round(rect.bottom + gutter) + "px";
      dropdown.style.right = Math.round(window.innerWidth - rect.right) + "px";
      dropdown.style.left = "auto";
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      position();
      dropdown.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      window.addEventListener("scroll", position, true);
      window.addEventListener("resize", position);
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKeydown, true);
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      dropdown.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKeydown, true);
      disarm();
    }

    function onDocClick(event) {
      if (dropdown.contains(event.target) || trigger.contains(event.target)) return;
      close();
    }

    function onKeydown(event) {
      if (event.key === "Escape") close();
    }

    trigger.addEventListener("click", function (event) {
      event.stopPropagation();
      if (isOpen) close(); else open();
    });

    // Two-step inline confirm instead of a blocking native confirm() -
    // first click arms it, second click (within 3s) signs out. Resets
    // if the menu closes in between.
    var logoutLabel = logoutBtn.querySelector("span");
    var defaultLabel = logoutLabel.textContent;
    var armed = false;
    var armTimer = null;

    function disarm() {
      armed = false;
      clearTimeout(armTimer);
      logoutBtn.classList.remove("user-menu__item--confirm");
      logoutLabel.textContent = defaultLabel;
    }

    logoutBtn.addEventListener("click", function () {
      if (!armed) {
        armed = true;
        logoutBtn.classList.add("user-menu__item--confirm");
        logoutLabel.textContent = "Click to confirm";
        armTimer = setTimeout(disarm, 3000);
        return;
      }
      disarm();
      close();
      performSignOut(logoutBtn);
    });

    if (window.firebase && firebase.auth) {
      firebase.auth().onAuthStateChanged(function (user) {
        var email = user && user.email ? user.email : "";
        emailEl.textContent = email || "Unknown user";
        initialEl.textContent = initials(email);
      });
    }
  }

  function performSignOut(triggerEl) {

    firebase.auth().signOut()

      .then(function () {

        sessionStorage.clear();
        localStorage.clear();

        window.location.replace("login.html");

      })

      .catch(function (error) {

        // Sign-out failures are rare (offline, etc.) - surface it on the
        // element that was clicked instead of blocking with alert().
        if (triggerEl) {
          var label = triggerEl.querySelector("span") || triggerEl;
          var original = label.textContent;
          label.textContent = "Couldn't sign out - retry";
          setTimeout(function () { label.textContent = original; }, 3000);
        }

      });

  }

  // Exposed for any page/legacy markup that still calls logout() directly.
  window.logout = performSignOut;

  document.addEventListener("DOMContentLoaded", function () {
    var mount = document.getElementById("user-menu");
    if (mount) buildMenu(mount);
  });

})();
