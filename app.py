import os
import json
import random
import traceback
import pandas as pd
from textblob import TextBlob
import csv
import numpy as np
from flask import Flask, render_template, request, jsonify
from model_utils import load_dataset, build_and_train, load_model, fallback_sample, DEFAULT_CSV_PATH
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from openai import OpenAI

from dotenv import load_dotenv
load_dotenv()

client = OpenAI()

app = Flask(__name__, static_folder='static', template_folder='templates')

# Paths for model and label encoder
MODEL_PATH = "models/mood_model.joblib"
LE_PATH = "models/label_encoder.joblib"

FEEDBACK_LOG = "data/feedback_log.csv"

def analyze_sentiment(feedback_text):
    """Analyze sentiment polarity of feedback."""
    blob = TextBlob(feedback_text)
    polarity = blob.sentiment.polarity
    if polarity > 0.1:
        return "positive"
    elif polarity < -0.1:
        return "negative"
    else:
        return "neutral"

# --- Helper: map detected label to a broad mood category ---
BROAD_MAPPINGS = {
    'happy': {'syn': {'happy','joy','joyful','glad','content','pleased','delighted','cheerful','excited','positive'}},
    'sad': {'syn': {'sad','sadness','down','unhappy','depressed','miserable','gloomy'}},
    'angry': {'syn': {'angry','anger','mad','furious','irritated','annoyed'}},
    'neutral': {'syn': {'neutral','ok','fine','meh','indifferent'}},
    'fear': {'syn': {'fear','scared','terrified','anxious','nervous','afraid'}},
    'surprise': {'syn': {'surprise','surprised','astonished','shocked'}},
    'disgust': {'syn': {'disgust','disgusted','repulsed'}},
}

def to_broad(mood_label):
    """Map a specific mood label to a broad category."""
    if mood_label is None:
        return 'neutral'
    ml = str(mood_label).lower()
    for broad, info in BROAD_MAPPINGS.items():
        for s in info['syn']:
            if s in ml:
                return broad
    return 'neutral'

def generate_reply(broad_mood, user_text):
    """Generate a reply using ChatGPT based on mood and user text."""
    
    prompt = f"""
    You are a friendly and emotionally intelligent chatbot.
    The user is feeling: {broad_mood}.
    They said: "{user_text}"

    Respond in a tone that matches their mood, staying conversational, natural, and concise.
    """

    response = client.chat.completions.create(
        model="gpt-4o-mini",  # you can use "gpt-4o" for higher quality
        messages=[
            {"role": "system", "content": "You are ChatGPT, a helpful emotional support assistant."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7,  # more creative = higher, more stable = lower
    )

    return response.choices[0].message.content.strip()

# --- Load or train model at startup ---
print("[app] Starting up, loading or training model...")
model, le = load_model(MODEL_PATH, LE_PATH)

if model is None or le is None:
    texts, labels = load_dataset(DEFAULT_CSV_PATH)
    if texts is None or labels is None:
        print("[app] Using fallback sample dataset.")
        texts, labels = fallback_sample()
    model, le = build_and_train(texts, labels, save_to=MODEL_PATH, le_save_to=LE_PATH)
else:
    print("[app] Model and label encoder loaded from disk.")

print("[app] Ready.")

# --- Routes ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(force=True)
    user_msg = data.get("message", "").strip()
    if not user_msg:
        return jsonify({"error": "Empty message"}), 400
    try:
        # Predict mood
        if hasattr(model, "predict_proba"):
            probs = model.predict_proba([user_msg])[0]
            pred_idx = probs.argmax()
            confidence = float(probs[pred_idx])
        else:
            pred_idx = int(model.predict([user_msg])[0])
            confidence = None

        mood_label = le.inverse_transform([pred_idx])[0]
        broad = to_broad(mood_label)
        reply = generate_reply(broad, user_msg)

        response = {
            "mood": str(mood_label),
            "broad_mood": broad,
            "reply": reply,
            "confidence": confidence
        }
        return jsonify(response)
    except Exception as e:
        print("[Error] /chat exception:", e)
        print(traceback.format_exc())
        return jsonify({"error": "internal server error"}), 500
    
def update_emotion_dataset(usertext, correct_emotion):
    """Update or append the correct emotion into emotion.csv"""
    emotion_file = "data/emotion.csv"  # keep inside 'data' folder for consistency

    # Load or create dataset
    if os.path.exists(emotion_file):
        emotion_df = pd.read_csv(emotion_file)
    else:
        emotion_df = pd.DataFrame(columns=["usertext", "emotion"])

    # Update if exists, else append
    if usertext in emotion_df['usertext'].values:
        emotion_df.loc[emotion_df['usertext'] == usertext, 'emotion'] = correct_emotion
    else:
        new_row = pd.DataFrame([[usertext, correct_emotion]], columns=["usertext", "emotion"])
        emotion_df = pd.concat([emotion_df, new_row], ignore_index=True)

    # Save it back (overwrite same file)
    emotion_df.to_csv(emotion_file, index=False)
    print(f"✅ Updated emotion.csv with: {usertext} → {correct_emotion}")


@app.route("/feedback", methods=["POST"])
def feedback():
    try:
        data = request.get_json(force=True)
        user_feedback = data.get("text", "").strip()
        predicted = data.get("predicted", "").strip()
        actual = data.get("actual", "").strip()

        if not user_feedback:
            return jsonify({"error": "Empty feedback"}), 400

        # Perform sentiment analysis
        sentiment = analyze_sentiment(user_feedback)

        # ---------- LOG TO feedback_log.csv ----------
        feedback_log_path = r"C:\Users\shrad\Desktop\ML_FINAL\data\feedback_log.csv"
        os.makedirs(os.path.dirname(feedback_log_path), exist_ok=True)
        with open(feedback_log_path, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([user_feedback, predicted, actual, sentiment])

        # ---------- UPDATE emotion.csv ----------
        emotion_file = r"C:\Users\shrad\Desktop\ML_FINAL\data\emotion.csv"
        os.makedirs(os.path.dirname(emotion_file), exist_ok=True)

        # Load existing emotion dataset
        if os.path.exists(emotion_file):
            with open(emotion_file, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                rows = list(reader)
        else:
            rows = [["text", "emotion"]]

        # Remove old entries with same text (avoid duplicates)
        rows = [r for r in rows if len(r) < 1 or r[0] != user_feedback]

        # Append corrected emotion
        rows.append([user_feedback, actual])

        # Write back updated file
        with open(emotion_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerows(rows)

        print(f"✅ Feedback saved: '{user_feedback}' | Pred: {predicted} | Actual: {actual}")

        return jsonify({
            "message": "Feedback and correction saved successfully",
            "sentiment": sentiment
        })

    except Exception as e:
        print("❌ Feedback error:", e)
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500

@app.route("/metrics")
def metrics():
    # Load dataset and model
    texts, labels = load_dataset("data/emotion.csv")
    model, le = load_model()

    if model is None or le is None or texts is None:
        return render_template("metrics.html", metrics_data=json.dumps({"error": "Model or dataset not found"}))

    # Predict using loaded model
    preds = model.predict(texts)
    try:
        preds_decoded = le.inverse_transform(preds)
    except Exception:
        preds_decoded = preds  # fallback if already decoded

    # Ensure consistent label types
    labels = [str(x) for x in labels]
    preds_decoded = [str(x) for x in preds_decoded]

    # Compute performance metrics
    report = classification_report(labels, preds_decoded, output_dict=True, zero_division=0)
    cm = confusion_matrix(labels, preds_decoded).tolist()
    unique_labels = sorted(list(set(labels + preds_decoded)))

    metrics_data = {
        "confusion_matrix": cm,
        "labels": unique_labels,
        "report": report
    }

    # Render HTML with metrics JSON
    return render_template("metrics.html", metrics_data=json.dumps(metrics_data))

# --- Run app ---
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
