with open("6of12.txt") as infile, open("words_3to7.txt", "w") as outfile:
    for word in infile:
        w = word.strip().upper()
        if 3 <= len(w) <= 7 and w.isalpha():
            outfile.write(w + "\n")
