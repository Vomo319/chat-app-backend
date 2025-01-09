'use client'

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

const WORDS = ['REACT', 'NEXTJS', 'TYPESCRIPT', 'JAVASCRIPT', 'TAILWIND', 'VERCEL'];

interface WordGuessGameProps {
  onGameEnd: (result: string) => void;
}

export const WordGuessGame: React.FC<WordGuessGameProps> = ({ onGameEnd }) => {
  const [word, setWord] = useState('');
  const [guess, setGuess] = useState('');
  const [attempts, setAttempts] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [gameOver, setGameOver] = useState(false);

  useEffect(() => {
    setWord(WORDS[Math.floor(Math.random() * WORDS.length)]);
  }, []);

  const handleGuess = () => {
    if (guess.length !== word.length) {
      alert(`Please enter a ${word.length}-letter word.`);
      return;
    }

    const newFeedback = guess.split('').map((letter, index) => {
      if (letter.toUpperCase() === word[index]) {
        return '🟩'; // Correct letter and position
      } else if (word.includes(letter.toUpperCase())) {
        return '🟨'; // Correct letter, wrong position
      } else {
        return '⬜'; // Letter not in word
      }
    });

    setAttempts([...attempts, guess.toUpperCase()]);
    setFeedback([...feedback, newFeedback.join('')]);
    setGuess('');

    if (guess.toUpperCase() === word) {
      setGameOver(true);
      onGameEnd(`Congratulations! You guessed the word ${word} in ${attempts.length + 1} attempts.`);
    } else if (attempts.length + 1 >= 6) {
      setGameOver(true);
      onGameEnd(`Game over! The word was ${word}.`);
    }
  };

  return (
    <Card className="w-full max-w-sm mx-auto">
      <CardHeader>
        <CardTitle>Word Guess Game</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {attempts.map((attempt, index) => (
            <div key={index} className="flex justify-between">
              <div>{attempt}</div>
              <div>{feedback[index]}</div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-2">
        <Input
          type="text"
          value={guess}
          onChange={(e) => setGuess(e.target.value.toUpperCase())}
          maxLength={word.length}
          placeholder={`Enter a ${word.length}-letter word`}
          disabled={gameOver}
        />
        <Button onClick={handleGuess} disabled={gameOver || guess.length !== word.length}>
          Guess
        </Button>
        {gameOver && (
          <Button onClick={() => window.location.reload()}>
            Play Again
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

