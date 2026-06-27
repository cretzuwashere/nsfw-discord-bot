/**
 * Bundled trivia question bank (SFW, general knowledge). In-repo data — no
 * external API. `options` always has exactly 4 entries; `correct` is the index.
 */

export interface TriviaQuestion {
  question: string;
  options: [string, string, string, string];
  correct: 0 | 1 | 2 | 3;
  category: string;
}

export const TRIVIA_BANK: readonly TriviaQuestion[] = [
  { question: 'What is the capital of Australia?', options: ['Sydney', 'Canberra', 'Melbourne', 'Perth'], correct: 1, category: 'Geography' },
  { question: 'How many continents are there on Earth?', options: ['5', '6', '7', '8'], correct: 2, category: 'Geography' },
  { question: 'Which planet is known as the Red Planet?', options: ['Venus', 'Jupiter', 'Mars', 'Saturn'], correct: 2, category: 'Science' },
  { question: 'What gas do plants primarily absorb from the air?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'], correct: 1, category: 'Science' },
  { question: 'What is the largest planet in our solar system?', options: ['Saturn', 'Neptune', 'Jupiter', 'Earth'], correct: 2, category: 'Science' },
  { question: 'Who painted the Mona Lisa?', options: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Donatello'], correct: 1, category: 'Art' },
  { question: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], correct: 1, category: 'Math' },
  { question: 'What is the chemical symbol for gold?', options: ['Go', 'Gd', 'Au', 'Ag'], correct: 2, category: 'Science' },
  { question: 'Which ocean is the largest?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3, category: 'Geography' },
  { question: 'In which country would you find the Eiffel Tower?', options: ['Italy', 'France', 'Spain', 'Germany'], correct: 1, category: 'Geography' },
  { question: 'What is the smallest prime number?', options: ['0', '1', '2', '3'], correct: 2, category: 'Math' },
  { question: 'Who wrote "Romeo and Juliet"?', options: ['Charles Dickens', 'Mark Twain', 'William Shakespeare', 'Jane Austen'], correct: 2, category: 'Literature' },
  { question: 'What is the hardest known natural material?', options: ['Gold', 'Iron', 'Diamond', 'Quartz'], correct: 2, category: 'Science' },
  { question: 'How many strings does a standard guitar have?', options: ['4', '5', '6', '7'], correct: 2, category: 'Music' },
  { question: 'Which animal is known as the "King of the Jungle"?', options: ['Tiger', 'Elephant', 'Lion', 'Bear'], correct: 2, category: 'Nature' },
  { question: 'What is the freezing point of water in Celsius?', options: ['0', '32', '100', '-10'], correct: 0, category: 'Science' },
  { question: 'Which language has the most native speakers?', options: ['English', 'Hindi', 'Spanish', 'Mandarin Chinese'], correct: 3, category: 'Geography' },
  { question: 'What is the largest mammal in the world?', options: ['Elephant', 'Blue whale', 'Giraffe', 'Hippopotamus'], correct: 1, category: 'Nature' },
  { question: 'How many minutes are there in a full day?', options: ['1200', '1440', '1600', '2400'], correct: 1, category: 'Math' },
  { question: 'Which element has the chemical symbol "O"?', options: ['Osmium', 'Oxygen', 'Gold', 'Oganesson'], correct: 1, category: 'Science' },
  { question: 'What is the tallest mountain above sea level?', options: ['K2', 'Mount Everest', 'Kilimanjaro', 'Denali'], correct: 1, category: 'Geography' },
  { question: 'Who developed the theory of general relativity?', options: ['Isaac Newton', 'Albert Einstein', 'Galileo Galilei', 'Nikola Tesla'], correct: 1, category: 'Science' },
  { question: 'What is the currency of Japan?', options: ['Yuan', 'Won', 'Yen', 'Ringgit'], correct: 2, category: 'Geography' },
  { question: 'How many colors are in a rainbow?', options: ['5', '6', '7', '8'], correct: 2, category: 'Science' },
  { question: 'Which is the longest river in the world?', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], correct: 1, category: 'Geography' },
  { question: 'What is the square root of 144?', options: ['10', '11', '12', '14'], correct: 2, category: 'Math' },
  { question: 'Which planet is closest to the Sun?', options: ['Venus', 'Mercury', 'Earth', 'Mars'], correct: 1, category: 'Science' },
  { question: 'What do bees collect and use to make honey?', options: ['Pollen', 'Nectar', 'Water', 'Sap'], correct: 1, category: 'Nature' },
  { question: 'How many players are on a standard soccer team on the field?', options: ['9', '10', '11', '12'], correct: 2, category: 'Sports' },
  { question: 'What is the capital of Canada?', options: ['Toronto', 'Vancouver', 'Ottawa', 'Montreal'], correct: 2, category: 'Geography' },
  { question: 'Which gas makes up most of Earth’s atmosphere?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Argon'], correct: 2, category: 'Science' },
  { question: 'Who is known as the "Father of Computers"?', options: ['Alan Turing', 'Charles Babbage', 'Bill Gates', 'Steve Jobs'], correct: 1, category: 'History' },
  { question: 'What is the largest organ of the human body?', options: ['Heart', 'Liver', 'Skin', 'Brain'], correct: 2, category: 'Science' },
  { question: 'In which year did World War II end?', options: ['1943', '1945', '1947', '1950'], correct: 1, category: 'History' },
  { question: 'What is the main ingredient in guacamole?', options: ['Tomato', 'Avocado', 'Pepper', 'Onion'], correct: 1, category: 'Food' },
  { question: 'How many legs does a spider have?', options: ['6', '8', '10', '12'], correct: 1, category: 'Nature' },
  { question: 'Which country is home to the kangaroo?', options: ['South Africa', 'Brazil', 'Australia', 'India'], correct: 2, category: 'Nature' },
  { question: 'What is the boiling point of water at sea level in Celsius?', options: ['90', '100', '110', '120'], correct: 1, category: 'Science' },
  { question: 'Which instrument has 88 keys?', options: ['Organ', 'Harp', 'Piano', 'Accordion'], correct: 2, category: 'Music' },
  { question: 'What is the national flower of Japan?', options: ['Rose', 'Tulip', 'Cherry blossom', 'Lotus'], correct: 2, category: 'Culture' },
];

export function getQuestion(index: number): TriviaQuestion {
  return TRIVIA_BANK[index] ?? TRIVIA_BANK[0]!;
}

export const ANSWER_LETTERS = ['A', 'B', 'C', 'D'] as const;
