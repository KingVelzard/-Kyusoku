import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ===== CONFIGURATION =====
const AUTH_API = "https://uxdhfxtrfmfqwfcmzpp3ovhfwi0wjqal.lambda-url.us-west-2.on.aws/";
const WORDS_API = "https://na7olsz3hwrolwq4gaz3zzkfye0dkvia.lambda-url.us-west-2.on.aws/";

// Enhanced Flashcard App
export default function FlashcardApp() {
  const [view, setView] = useState("login");
  const [user, setUser] = useState(null);
  const [words, setWords] = useState([]);
  const [filteredWords, setFilteredWords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Auth form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);

  // Study mode
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [studyWords, setStudyWords] = useState([]);
  const [shuffleStudy, setShuffleStudy] = useState(false);
  const [cardStatus, setCardStatus] = useState({}); // key: word id, value: "default" | "mastered" | "difficult"
  const [savingStatus, setSavingStatus] = useState(false);
  const [lastSyncedStatus, setLastSyncedStatus] = useState({}); // Track what was last synced
  const [syncQueue, setSyncQueue] = useState([]); // Queue of pending updates
  const syncTimerRef = useRef(null);
  const [searchInput, setSearchInput] = useState(""); // Search input state

  const searchInputRef = useRef(null);
  const prevViewRef = useRef(view);

  useEffect(() => {
    if (view === "dashboard" && prevViewRef.current !== "dashboard") {
      searchInputRef.current?.focus();
    }
    prevViewRef.current = view;
  }, [view]);

  // Load card status from localStorage on mount
  useEffect(() => {
    const savedStatus = localStorage.getItem('cardStatus');
    if (savedStatus) {
      try {
        const parsed = JSON.parse(savedStatus);
        setCardStatus(parsed);
        setLastSyncedStatus(parsed); // Initialize as synced
      } catch (err) {
        console.error("Failed to load saved card status:", err);
      }
    }
  }, []);

  // Save card status to localStorage whenever it changes
  useEffect(() => {
    if (Object.keys(cardStatus).length > 0) {
      localStorage.setItem('cardStatus', JSON.stringify(cardStatus));
    }
  }, [cardStatus]);

  // Periodic sync: Check for changes every 10 seconds
  useEffect(() => {
    if (!user) return;

    const syncChanges = async () => {
      // Find cards with status changes
      const changes = [];
      
      for (const [cardId, status] of Object.entries(cardStatus)) {
        if (lastSyncedStatus[cardId] !== status) {
          const word = words.find(w => w.id === cardId);
          if (word) {
            changes.push({ word: word.word, status, cardId });
          }
        }
      }

      // Also check for deletions (cards that were in lastSynced but not in current)
      for (const [cardId, status] of Object.entries(lastSyncedStatus)) {
        if (!(cardId in cardStatus)) {
          const word = words.find(w => w.id === cardId);
          if (word) {
            changes.push({ word: word.word, status: "default", cardId });
          }
        }
      }

      if (changes.length > 0) {
        console.log(`Syncing ${changes.length} status changes to backend...`);
        await batchUpdateStatus(changes);
      }
    };

    // Start periodic sync
    syncTimerRef.current = setInterval(syncChanges, 10000); // Every 10 seconds

    return () => {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
      }
    };
  }, [user, cardStatus, lastSyncedStatus, words]);

  // Sync on unmount/page close
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use localStorage as a bridge to ensure data is available
      localStorage.setItem('pendingSync', JSON.stringify({
        cardStatus,
        lastSyncedStatus
      }));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [cardStatus, lastSyncedStatus]);

  // Check for existing auth
  useEffect(() => {
    const token = localStorage.getItem("token");
    const userId = localStorage.getItem("userId");
    const userEmail = localStorage.getItem("email");

    if (token && userId && userEmail) {
      setUser({ token, userId, email: userEmail });
      setView("dashboard");
    }
  }, []);

  // Load words when logged in
  useEffect(() => {
    if (user && view === "dashboard") {
      loadWords();
    }
  }, [user, view]);

  // Filter words based on search
  useEffect(() => {
    if (searchTerm) {
      const filtered = words.filter((word) =>
        word.word.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (word.readings || []).some((r) => r.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (word.definitions || []).some((d) => d.toLowerCase().includes(searchTerm.toLowerCase()))
      );
      setFilteredWords(filtered);
    } else {
      setFilteredWords(words);
    }
  }, [searchTerm, words]);

  // Compute derived stats
  const masteredWords = useMemo(() => {
    return new Set(Object.keys(cardStatus).filter(id => cardStatus[id] === "mastered"));
  }, [cardStatus]);

  const difficultWords = useMemo(() => {
    return new Set(Object.keys(cardStatus).filter(id => cardStatus[id] === "difficult"));
  }, [cardStatus]);

  // ===== API FUNCTIONS =====
  const handleAuth = async (e) => {
    e && e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(AUTH_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isSignup ? "signup" : "login",
          email,
          password,
        }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("userId", data.userId);
        localStorage.setItem("email", data.email);
        setUser({ token: data.token, userId: data.userId, email: data.email });
        setView("dashboard");
        setEmail("");
        setPassword("");
      } else {
        setError(data.error || "Authentication failed");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const loadWords = async (forceRefresh = false) => {
    if (!user) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(WORDS_API, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${user.token}`,
        },
        cache: forceRefresh ? "reload" : "default",
      });

      const data = await response.json();

      if (response.ok && data.words) {
        setWords(data.words);
        setFilteredWords(data.words);
        
        // Build status from backend
        const backendStatus = {};
        data.words.forEach(word => {
          if (word.status && word.status !== "default") {
            backendStatus[word.id] = word.status;
          }
        });
        
        // Check if we have pending sync from previous session
        const pendingSync = localStorage.getItem('pendingSync');
        if (pendingSync) {
          try {
            const { cardStatus: pending } = JSON.parse(pendingSync);
            // Merge: local pending changes take precedence
            const merged = { ...backendStatus, ...pending };
            setCardStatus(merged);
            setLastSyncedStatus(backendStatus); // Backend is the last known synced state
            localStorage.removeItem('pendingSync'); // Clear pending
            
            // Trigger immediate sync of pending changes
            const changes = [];
            for (const [cardId, status] of Object.entries(pending)) {
              if (backendStatus[cardId] !== status) {
                const word = data.words.find(w => w.id === cardId);
                if (word) {
                  changes.push({ word: word.word, status, cardId });
                }
              }
            }
            if (changes.length > 0) {
              console.log("Syncing pending changes from previous session...");
              await batchUpdateStatus(changes);
            }
          } catch (err) {
            console.error("Failed to process pending sync:", err);
          }
        } else {
          // No pending changes, use backend as source of truth
          setCardStatus(backendStatus);
          setLastSyncedStatus(backendStatus);
        }
      } else {
        setError(data.error || "Failed to load words");
      }
    } catch (err) {
      setError("Failed to load words: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Batch update multiple statuses
  const batchUpdateStatus = async (changes) => {
    if (!user || changes.length === 0) return;
    
    console.log("🔄 Starting batch update:", changes);
    setSavingStatus(true);
    const results = [];
    
    try {
      for (const change of changes) {
        console.log("📤 Sending update:", change);
        try {
          const response = await fetch(WORDS_API, {
            method: "PUT",
            headers: {
              "Authorization": `Bearer ${user.token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              word: change.word,
              status: change.status
            })
          });

          const result = await response.json();
          console.log("📥 Response:", { status: response.status, result });
          
          if (response.ok) {
            results.push({ success: true, cardId: change.cardId, status: change.status });
            console.log("✅ Successfully synced:", change.cardId);
          } else {
            console.error("❌ Failed to update status:", result);
            results.push({ success: false, cardId: change.cardId, error: result.error });
          }
        } catch (err) {
          console.error("❌ Error updating status:", err);
          results.push({ success: false, cardId: change.cardId, error: err.message });
        }
      }
      
      // Update lastSyncedStatus for successful syncs
      const newSynced = { ...lastSyncedStatus };
      results.forEach(r => {
        if (r.success) {
          newSynced[r.cardId] = r.status;
        }
      });
      setLastSyncedStatus(newSynced);
      
      const successCount = results.filter(r => r.success).length;
      console.log(`✅ Synced ${successCount}/${changes.length} status changes`);
      
      if (successCount < changes.length) {
        const failures = results.filter(r => !r.success);
        console.error("⚠️ Some updates failed:", failures);
      }
      
    } catch (err) {
      console.error("❌ Batch update failed:", err);
      setError("Failed to save some status changes: " + err.message);
    } finally {
      setSavingStatus(false);
    }
  };

  // Update status in backend (single update - for immediate feedback)
  const updateCardStatus = async (word, status) => {
    if (!user) return;
    
    setSavingStatus(true);
    try {
      const response = await fetch(WORDS_API, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${user.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          word: word.word,
          status: status
        })
      });

      const result = await response.json();
      
      if (!response.ok) {
        console.error("Failed to update status on server:", result);
        setError("Failed to save status: " + (result.error || "Unknown error"));
      } else {
        console.log("Status saved successfully:", result);
        // Update lastSyncedStatus
        setLastSyncedStatus(prev => ({
          ...prev,
          [word.id]: status
        }));
      }
    } catch (err) {
      console.error("Failed to update status:", err);
      setError("Failed to save status: " + err.message);
    } finally {
      setSavingStatus(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userId");
    localStorage.removeItem("email");
    // Keep cardStatus in localStorage so it persists across sessions
    setUser(null);
    setWords([]);
    setFilteredWords([]);
    setSearchTerm("");
    setCardStatus({});
    setView("login");
  };

  // ===== STUDY FUNCTIONS =====
  const startStudying = (shuffle = false) => {
    if (filteredWords.length === 0) return;

    let wordsToStudy = [...filteredWords];
    if (shuffle) {
      wordsToStudy = wordsToStudy.sort(() => Math.random() - 0.5);
    }

    setStudyWords(wordsToStudy);
    setCurrentCardIndex(0);
    setShowAnswer(false);
    setView("study");
  };

  const startStudyingFromWord = (word) => {
    // Get the filtered words
    let wordsToStudy = [...filteredWords];
    
    // Apply shuffle if enabled
    if (shuffleStudy) {
      wordsToStudy = wordsToStudy.sort(() => Math.random() - 0.5);
    }
    
    // Find the index of this word in the (possibly shuffled) list
    const startIndex = wordsToStudy.findIndex(w => w.id === word.id);
    if (startIndex === -1) return;

    setStudyWords(wordsToStudy);
    setCurrentCardIndex(startIndex);
    setShowAnswer(false);
    setView("study");
  };

  const markMastered = async () => {
    if (!currentCard) return;
    setCardStatus(prev => ({
      ...prev,
      [currentCard.id]: "mastered"
    }));
    await updateCardStatus(currentCard, "mastered");
  };

  const markDifficult = async () => {
    if (!currentCard) return;
    setCardStatus(prev => ({
      ...prev,
      [currentCard.id]: "difficult"
    }));
    await updateCardStatus(currentCard, "difficult");
  };

  const nextCard = () => {
    setShowAnswer(false);
    if (currentCardIndex < studyWords.length - 1) {
      setCurrentCardIndex((prev) => prev + 1);
    } else {
      // Reached end - return to dashboard
      setView("dashboard");
    }
  };

  const prevCard = () => {
    setShowAnswer(false);
    if (currentCardIndex > 0) {
      setCurrentCardIndex((prev) => prev - 1);
    }
  };

  const handleKeyPress = useCallback(
    (e) => {
      if (view !== "study") return;

      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setShowAnswer((prev) => !prev);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nextCard();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevCard();
      }
    },
    [view, currentCardIndex, studyWords]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [handleKeyPress]);

  const currentCard = studyWords[currentCardIndex];
  const progress = studyWords.length > 0 ? ((currentCardIndex + 1) / studyWords.length) * 100 : 0;

  const BrandHeader = () => {
    const hasUnsyncedChanges = useMemo(() => {
      for (const [cardId, status] of Object.entries(cardStatus)) {
        if (lastSyncedStatus[cardId] !== status) return true;
      }
      for (const cardId of Object.keys(lastSyncedStatus)) {
        if (!(cardId in cardStatus)) return true;
      }
      return false;
    }, [cardStatus, lastSyncedStatus]);

    return (
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg text-white font-bold text-xl">
          休
        </div>
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Kyusoku Flashcards
          </h1>
          <p className="text-xs text-gray-500">
            Master Japanese vocabulary efficiently
            {hasUnsyncedChanges && (
              <span className="ml-2 text-orange-500">● Syncing changes...</span>
            )}
            {!hasUnsyncedChanges && user && (
              <span className="ml-2 text-green-500">✓ All changes saved</span>
            )}
          </p>
        </div>
      </div>
    );
  };

  // ===== LOGIN VIEW =====
  const LoginView = () => {
    const [localEmail, setLocalEmail] = useState(email);
    const [localPassword, setLocalPassword] = useState(password);
    const [localIsSignup, setLocalIsSignup] = useState(isSignup);

    const handleSubmit = (e) => {
      e.preventDefault();
      setEmail(localEmail);
      setPassword(localPassword);
      setIsSignup(localIsSignup);
      handleAuth(e);
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 flex items-center justify-center p-6">
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl p-10 w-full max-w-lg border border-white/20">
          <BrandHeader />

          <div className="mt-8">
            <h2 className="text-3xl font-bold text-gray-800">
              {localIsSignup ? "Create account" : "Welcome back"}
            </h2>
            <p className="text-sm text-gray-600 mt-2">
              Practice Japanese words with an elegant, keyboard-friendly interface.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={localEmail}
                onChange={(e) => setLocalEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
              <input
                type="password"
                value={localPassword}
                onChange={(e) => setLocalPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                placeholder="••••••••"
                required
                minLength={8}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white py-3 rounded-xl font-semibold shadow-lg transform transition hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Loading..." : localIsSignup ? "Create Account" : "Login"}
            </button>

            <div className="text-center text-sm text-gray-600">
              <button
                type="button"
                onClick={() => {
                  setLocalIsSignup(!localIsSignup);
                  setError("");
                }}
                className="text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                {localIsSignup ? "Already have an account? Log in" : "Don't have an account? Sign up"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // ===== FLASHCARD COMPONENT =====
  const Flashcard = ({ card, showAnswerLocal, onFlip, cardStatus }) => {
    if (!card) return null;

    const reading = (card?.readings || []).join(" • ");
    const defs = (card?.definitions || []).join(" • ");
    const status = cardStatus[card.id] || "default";
    const isMastered = status === "mastered";
    const isDifficult = status === "difficult";

    return (
      <div className="w-full max-w-3xl mx-auto">
        <div 
          className="relative h-96 cursor-pointer"
          onClick={onFlip}
        >
          <div
            className="absolute inset-0 w-full h-full transition-transform transform-gpu"
            style={{
              transformStyle: "preserve-3d",
              perspective: "1000px",
              transform: showAnswerLocal ? "rotateY(180deg)" : "rotateY(0deg)",
              transition: "transform 0.5s",
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 bg-gradient-to-br from-white to-indigo-50 rounded-3xl p-10 shadow-2xl border border-indigo-100 flex flex-col justify-center"
              style={{ backfaceVisibility: "hidden" }}
            >
              <div className="text-center space-y-6">
                <div className="text-7xl font-bold text-gray-800">{card?.word}</div>
                <div className="flex justify-center gap-3 mt-8">
                  {isMastered && (
                    <span className="px-4 py-2 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                      ✓ Mastered
                    </span>
                  )}
                  {isDifficult && (
                    <span className="px-4 py-2 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">
                      ⚠ Review
                    </span>
                  )}
                </div>
              </div>
              <div className="absolute bottom-8 left-0 right-0 text-center text-gray-400 text-sm">
                Click or press Space to reveal
              </div>
            </div>

            {/* Back */}
            <div
              className="absolute inset-0 bg-gradient-to-br from-purple-50 to-pink-50 rounded-3xl p-10 shadow-2xl border border-purple-100 flex flex-col justify-center"
              style={{
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              <div className="space-y-6">
                <div className="text-lg font-semibold text-gray-600 mb-2">Definition:</div>
                <div className="text-2xl text-gray-800 leading-relaxed font-medium">
                  {defs || "No definitions available"}
                </div>
                {reading && (
                  <div className="text-base text-gray-500 border-t border-gray-300 pt-4 mt-6">
                    <div className="font-semibold mb-1">Reading:</div>
                    <div className="text-lg">{reading}</div>
                  </div>
                )}
                <div className="text-base text-gray-400 border-t border-gray-300 pt-4 mt-4">
                  <div className="font-semibold mb-1">Word:</div>
                  <div className="text-2xl font-bold text-gray-700">{card?.word}</div>
                </div>
              </div>
              <div className="absolute bottom-8 left-0 right-0 text-center text-gray-400 text-sm">
                Click or press Space to flip back
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ===== STUDY VIEW =====
  const StudyView = () => (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <BrandHeader />
          <button
            onClick={() => setView("dashboard")}
            className="px-4 py-2 bg-white rounded-xl shadow hover:shadow-lg transition text-gray-700 font-medium"
          >
            ← Back to Dashboard
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Card Area */}
          <div className="lg:col-span-3 space-y-6">
            {currentCard ? (
              <>
                <Flashcard 
                  card={currentCard} 
                  showAnswerLocal={showAnswer} 
                  onFlip={() => setShowAnswer((s) => !s)}
                  cardStatus={cardStatus}
                />

                {/* Controls */}
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={prevCard}
                    disabled={currentCardIndex === 0}
                    className="px-6 py-3 bg-white rounded-xl shadow hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setShowAnswer((s) => !s)}
                    className="px-8 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl shadow-lg hover:shadow-xl transition font-semibold"
                  >
                    {showAnswer ? "Hide" : "Show"} Answer
                  </button>
                  <button
                    onClick={nextCard}
                    disabled={currentCardIndex === studyWords.length - 1}
                    className="px-6 py-3 bg-white rounded-xl shadow hover:shadow-lg transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>

                {/* Quick Actions */}
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={markDifficult}
                    disabled={savingStatus}
                    className="px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition disabled:opacity-50"
                  >
                    {savingStatus ? "💾 Saving..." : "⚠ Mark Difficult"}
                  </button>
                  <button
                    onClick={markMastered}
                    disabled={savingStatus}
                    className="px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition disabled:opacity-50"
                  >
                    {savingStatus ? "💾 Saving..." : "✓ Mark Mastered"}
                  </button>
                  <button
                    onClick={() => {
                      if (!currentCard) return;
                      setCardStatus(prev => {
                        const newStatus = { ...prev };
                        delete newStatus[currentCard.id];
                        return newStatus;
                      });
                      updateCardStatus(currentCard, "default");
                    }}
                    disabled={savingStatus}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition disabled:opacity-50"
                  >
                    ↺ Reset Status
                  </button>
                </div>
              </>
            ) : (
              <div className="bg-white rounded-3xl shadow-xl p-12 text-center">
                <div className="text-6xl mb-4">📚</div>
                <div className="text-xl font-semibold text-gray-600">No cards to study</div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            {/* Progress */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h3 className="font-semibold text-gray-800 mb-4">Progress</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600">Card {currentCardIndex + 1} of {studyWords.length}</span>
                    <span className="font-semibold text-indigo-600">{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-indigo-600 to-purple-600 h-2 rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-4 border-t">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{masteredWords.size}</div>
                    <div className="text-xs text-gray-500">Mastered</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">{difficultWords.size}</div>
                    <div className="text-xs text-gray-500">Need Review</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h3 className="font-semibold text-gray-800 mb-4">Quick Jump</h3>
              <input
                type="range"
                min={1}
                max={studyWords.length || 1}
                value={currentCardIndex + 1}
                onChange={(e) => {
                  setCurrentCardIndex(Number(e.target.value) - 1);
                  setShowAnswer(false);
                }}
                className="w-full"
              />
              <div className="text-center text-sm text-gray-600 mt-2">
                Slide to jump between cards
              </div>
            </div>

            {/* Keyboard Shortcuts */}
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl shadow p-6">
              <h3 className="font-semibold text-gray-800 mb-3">Keyboard Shortcuts</h3>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Space/Enter</span>
                  <span className="font-mono bg-white px-2 py-1 rounded">Flip</span>
                </div>
                <div className="flex justify-between">
                  <span>←</span>
                  <span className="font-mono bg-white px-2 py-1 rounded">Previous</span>
                </div>
                <div className="flex justify-between">
                  <span>→</span>
                  <span className="font-mono bg-white px-2 py-1 rounded">Next</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );

  // ===== DASHBOARD VIEW =====
  const DashboardView = () => {
    const [appliedSearch, setAppliedSearch] = useState("");

    const handleSearchKey = (e) => {
      if (e.key === "Enter") {
        setAppliedSearch(e.target.value);
      }
    };

    const filteredWords = useMemo(() => {
      if (!appliedSearch) return words;
      const lower = appliedSearch.toLowerCase();
      return words.filter(
        (word) =>
          word.word.toLowerCase().includes(lower) ||
          (word.readings || []).some((r) => r.toLowerCase().includes(lower)) ||
          (word.definitions || []).some((d) => d.toLowerCase().includes(lower))
      );
    }, [appliedSearch, words]);

    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
            <BrandHeader />

            <div className="flex items-center gap-3">
              <div className="bg-white rounded-xl shadow px-4 py-2 flex items-center gap-2">
                <input
                  ref={searchInputRef}
                  placeholder="Search words... (press Enter)"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearchKey}
                  className="outline-none text-sm w-48"
                />
                <span className="text-gray-400">🔍</span>
              </div>

              <button
                onClick={() => startStudying(shuffleStudy)}
                disabled={filteredWords.length === 0}
                className="px-6 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold shadow-lg hover:shadow-xl transition disabled:opacity-50"
              >
                Start Studying
              </button>

              <button
                onClick={logout}
                className="px-4 py-2 rounded-xl bg-white shadow hover:shadow-lg transition"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <div className="text-sm text-gray-600 mb-1">Total Words</div>
              <div className="text-4xl font-bold text-indigo-600">{words.length}</div>
            </div>
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <div className="text-sm text-gray-600 mb-1">Filtered Results</div>
              <div className="text-4xl font-bold text-purple-600">{filteredWords.length}</div>
            </div>
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <div className="text-sm text-gray-600 mb-1">Mastered</div>
              <div className="text-4xl font-bold text-green-600">{masteredWords.size}</div>
            </div>
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <div className="text-sm text-gray-600 mb-1">Need Review</div>
              <div className="text-4xl font-bold text-orange-600">{difficultWords.size}</div>
            </div>
          </div>

          {/* Controls */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Study Options</h2>
                <p className="text-sm text-gray-600 mt-1">Customize your learning experience</p>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shuffleStudy}
                    onChange={(e) => setShuffleStudy(e.target.checked)}
                    className="w-5 h-5 text-indigo-600"
                  />
                  <span className="text-sm font-medium text-gray-700">Shuffle cards</span>
                </label>
                <button
                  onClick={() => loadWords(true)}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition text-sm font-medium disabled:opacity-50"
                >
                  {loading ? "Loading..." : "🔄 Refresh"}
                </button>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-2xl mb-8 flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <div className="font-semibold">Error</div>
                <div className="text-sm">{error}</div>
              </div>
            </div>
          )}

          {/* Word List */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6">Your Vocabulary</h2>

            {loading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
                <div className="mt-4 text-gray-600">Loading your words...</div>
              </div>
            ) : filteredWords.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📚</div>
                <div className="text-xl font-semibold text-gray-600">
                  {searchTerm ? "No words found" : "No words yet"}
                </div>
                <div className="text-sm text-gray-500 mt-2">
                  {searchTerm ? "Try a different search term" : "Add some words to get started"}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredWords.map((w) => {
                  const status = cardStatus[w.id] || "default";
                  const isMastered = status === "mastered";
                  const isDifficult = status === "difficult";

                  return (
                    <div
                      key={w.id}
                      className="group p-6 bg-gradient-to-br from-white to-indigo-50 rounded-xl border border-indigo-100 hover:shadow-lg transition"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="text-3xl font-bold text-gray-800 group-hover:text-indigo-600 transition">
                          {w.word}
                        </div>
                        <div className="flex gap-1">
                          {isMastered && <span className="text-green-500">✓</span>}
                          {isDifficult && <span className="text-orange-500">⚠</span>}
                        </div>
                      </div>

                      <div className="text-sm text-gray-600 mb-3">
                        {(w.readings || []).join(" • ") || "—"}
                      </div>

                      <div className="text-sm text-gray-700 line-clamp-2 mb-4">
                        {(w.definitions || []).slice(0, 2).join(" • ") || "—"}
                      </div>

                      <button
                        onClick={() => startStudyingFromWord(w)}
                        className="w-full px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition"
                      >
                        Study this word
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-8 text-center text-sm text-gray-500">
            <p>休速 flashcards • Made with care for effective learning</p>
            <p className="mt-2">Press Space/Enter to flip • Use ← → to navigate</p>
          </div>
        </div>
      </div>
    );
  };

  // ===== MAIN RENDER =====
  if (view === "login") return <LoginView />;
  if (view === "study") return <StudyView />;
  return <DashboardView />;
}