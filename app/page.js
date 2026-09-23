"use client";

import { useState, useEffect } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { getDeviceId } from "../lib/deviceId";
import { useRouter } from "next/navigation";

const CAROUSEL_IMAGES = [
  { src: "/carousel/robot-arm.jpg", alt: "Industrial robotic arm on a manufacturing line" },
  { src: "/carousel/cnc-machining.jpg", alt: "CNC machining center" },
  { src: "/carousel/machinery-hall.jpg", alt: "Industrial machinery hall" },
  { src: "/carousel/blueprint.jpg", alt: "Engineering blueprint drawing" },
  { src: "/carousel/willis-tower.jpg", alt: "Willis Tower, Chicago" },
  { src: "/carousel/chicago-skyline.jpg", alt: "Chicago skyline from the lakefront" },
  { src: "/carousel/hancock-center.jpg", alt: "John Hancock Center, Chicago" },
  { src: "/carousel/marina-city.jpg", alt: "Marina City, Chicago" },
];

function ImageCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % CAROUSEL_IMAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="carousel">
      {CAROUSEL_IMAGES.map((img, i) => (
        <img
          key={img.src}
          src={img.src}
          alt={img.alt}
          className="carousel-slide"
          style={{ opacity: i === index ? 1 : 0 }}
        />
      ))}
      <div className="carousel-overlay" />
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();

  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  // The second step for admins: while this is on, the browser is signed
  // out and waiting for the emailed code.
  const [codeStep, setCodeStep] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [busy, setBusy] = useState(false);

  const finish = () => {
    localStorage.setItem("loginTimestamp", String(Date.now()));
    router.push("/dashboard");
  };

  // Admins on a device that hasn't passed a code in the last 30 days get
  // one emailed, and are signed straight back out until they enter it --
  // so an unfinished sign-in leaves no way into anything.
  const maybeAskForCode = async (user) => {
    const res = await fetch("/api/login-code/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`
      },
      body: JSON.stringify({ deviceId: getDeviceId() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't start the login check");
    if (!data.needsCode) return false;

    await signOut(auth);
    setCodeStep(true);
    setCode("");
    setCodeError("");
    return true;
  };

  const login = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userRef = doc(db, "users", cred.user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        // First-ever login for this account: bootstrap a profile. If the
        // one-time bootstrap marker doesn't exist yet, this is the master
        // account -> admin. The Firestore rules enforce this same check
        // server-side so no one else can self-assign the admin role later.
        const configRef = doc(db, "system", "config");
        const configSnap = await getDoc(configRef);
        const isFirstUser = !configSnap.exists();

        await setDoc(userRef, {
          email: cred.user.email,
          role: isFirstUser ? "admin" : "member",
          disabled: false,
          createdAt: new Date().toISOString()
        });

        if (isFirstUser) {
          await setDoc(configRef, { bootstrapped: true, createdAt: new Date().toISOString() });
        }
      } else if (userSnap.data().disabled) {
        await signOut(auth);
        alert("This account has been disabled. Contact your admin.");
        return;
      }

      if (await maybeAskForCode(cred.user)) return;
      finish();
    } catch (err) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        alert("Login failed: incorrect email or password");
      } else {
        alert(`Login failed: ${err.message || err.code}`);
      }
    } finally {
      setBusy(false);
    }
  };

  // The code is checked without a session -- see the verify route. Once
  // it's accepted the device is trusted and we sign in properly, using the
  // password that's still in this form, so nothing was held onto anywhere.
  const submitCode = async () => {
    if (busy) return;
    if (!code.trim()) return setCodeError("Enter the code from your email.");
    setBusy(true);
    setCodeError("");
    try {
      const res = await fetch("/api/login-code/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: code.trim(), deviceId: getDeviceId() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCodeError(data.error || "That code didn't work.");
        return;
      }

      await signInWithEmailAndPassword(auth, email, password);
      finish();
    } catch (err) {
      setCodeError(err.message || "Couldn't finish signing in.");
    } finally {
      setBusy(false);
    }
  };

  const startOver = async () => {
    setCodeStep(false);
    setCode("");
    setCodeError("");
    setPassword("");
  };

  const sendReset = async () => {
    if (!resetEmail) {
      return alert("Enter your email");
    }
    try {
      const res = await fetch("/api/send-reset-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send reset email");

      alert("If an account exists for that email, a reset link is on its way.");
      setShowForgot(false);
      setResetEmail("");
    } catch (err) {
      alert(err.message || "Could not send reset email");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-visual">
        <ImageCarousel />
        <div className="auth-visual-content">
          <img src="/logo.svg" alt="Bullock Logan" className="auth-logo" />
          <p className="auth-visual-tagline">Engineering-grade customer relationship management.</p>
        </div>
      </div>

      <div className="auth-form-panel">
        <div className="auth-card">
          {codeStep ? (
            <>
              <h2 className="auth-title">Check your email</h2>
              <p className="auth-subtitle">
                We sent a six-digit code to <strong>{email}</strong>. It works for the next 10 minutes.
              </p>

              <label className="field-label" htmlFor="login-code">Login code</label>
              <input
                id="login-code"
                className="field"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                style={{ letterSpacing: 6, fontSize: 20 }}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(); }}
              />

              {codeError && <p className="settings-status is-error">{codeError}</p>}

              <button className="btn btn-primary btn-block" disabled={busy} onClick={submitCode}>
                {busy ? "Checking..." : "Sign In"}
              </button>

              <p className="auth-subtitle" style={{ marginTop: 14, marginBottom: 0, fontSize: 12 }}>
                Once this code is accepted, this device won&apos;t need one again for 30 days.
              </p>

              <div className="auth-footer">
                <a href="#" className="link-muted" onClick={(e) => { e.preventDefault(); startOver(); }}>
                  Use a different account
                </a>
              </div>
            </>
          ) : (
            <>
              <h2 className="auth-title">CRM Login</h2>
              <p className="auth-subtitle">Sign in to manage your customers.</p>

              <label className="field-label" htmlFor="login-email">Email</label>
              <input id="login-email" className="field" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />

              <label className="field-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className="field"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") login(); }}
              />

              <button className="btn btn-primary btn-block" disabled={busy} onClick={login}>
                {busy ? "Signing in..." : "Login"}
              </button>

              <div className="auth-footer">
                <a href="#" className="link-muted" onClick={(e) => { e.preventDefault(); setShowForgot(true); }}>
                  Forgot password?
                </a>
              </div>
            </>
          )}
        </div>
      </div>

      {showForgot && (
        <div className="modal-overlay">
          <div className="modal-card">
            <button className="modal-close" onClick={() => { setShowForgot(false); setResetEmail(""); }}>✕</button>

            <h3 className="modal-title">Reset Password</h3>
            <p className="modal-subtitle">
              Enter the email associated with your account.
            </p>
            <input
              className="field"
              placeholder="Email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={sendReset}>Send Reset Email</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
