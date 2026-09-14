"use client";

import { useState, useEffect } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
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

  const login = async () => {
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

      localStorage.setItem("loginTimestamp", String(Date.now()));
      router.push("/dashboard");
    } catch (err) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        alert("Login failed: incorrect email or password");
      } else {
        alert(`Login failed: ${err.message || err.code}`);
      }
    }
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
          <h2 className="auth-title">CRM Login</h2>
          <p className="auth-subtitle">Sign in to manage your customers.</p>

          <label className="field-label" htmlFor="login-email">Email</label>
          <input id="login-email" className="field" placeholder="Email" onChange={(e) => setEmail(e.target.value)} />

          <label className="field-label" htmlFor="login-password">Password</label>
          <input id="login-password" className="field" type="password" placeholder="Password" onChange={(e) => setPassword(e.target.value)} />

          <button className="btn btn-primary btn-block" onClick={login}>Login</button>

          <div className="auth-footer">
            <a href="#" className="link-muted" onClick={(e) => { e.preventDefault(); setShowForgot(true); }}>
              Forgot password?
            </a>
          </div>
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
