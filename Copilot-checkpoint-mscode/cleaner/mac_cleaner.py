#!/usr/bin/env python3
import os
import shutil
import subprocess
from pathlib import Path
import logging
from datetime import datetime

class MacCleaner:
    def __init__(self):
        self.home = str(Path.home())
        self.log_file = os.path.join(self.home, 'cleaner_log.txt')
        logging.basicConfig(
            filename=self.log_file,
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s'
        )
        self.total_cleaned = 0
        self.is_root = os.geteuid() == 0

    def get_size_format(self, bytes):
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if bytes < 1024.0:
                return f"{bytes:.2f} {unit}"
            bytes /= 1024.0

    def run_as_user(self, cmd):
        if self.is_root:
            sudo_user = os.environ.get('SUDO_USER')
            if sudo_user:
                return subprocess.run(['su', sudo_user, '-c', ' '.join(cmd)], check=False)
        return subprocess.run(cmd, check=False)

    def clean_directory(self, directory, pattern=None):
        try:
            if os.path.exists(directory):
                before_size = sum(f.stat().st_size for f in Path(directory).glob('**/*') if f.is_file())
                if pattern:
                    for item in Path(directory).glob(pattern):
                        try:
                            if item.is_file():
                                item.unlink(missing_ok=True)
                            elif item.is_dir():
                                shutil.rmtree(item, ignore_errors=True)
                        except PermissionError:
                            logging.warning(f"Permission refusée pour {item}")
                else:
                    try:
                        if os.path.exists(directory):
                            shutil.rmtree(directory, ignore_errors=True)
                            os.makedirs(directory, exist_ok=True)
                    except PermissionError:
                        logging.warning(f"Permission refusée pour {directory}")
                
                after_size = sum(f.stat().st_size for f in Path(directory).glob('**/*') if f.is_file())
                cleaned = before_size - after_size
                self.total_cleaned += cleaned
                logging.info(f"Nettoyé {self.get_size_format(cleaned)} de {directory}")
                return cleaned
        except Exception as e:
            logging.error(f"Erreur lors du nettoyage de {directory}: {str(e)}")
        return 0

    def clean_system(self):
        logging.info("=== Début du nettoyage système ===")
        print("Début du nettoyage système...")
        
        # Nettoyer les caches utilisateur
        user_cache_dirs = [
            os.path.join(self.home, 'Library/Caches'),
            os.path.join(self.home, 'Library/Logs'),
            os.path.join(self.home, '.npm/_cacache'),
            os.path.join(self.home, '.gradle/caches'),
            os.path.join(self.home, 'Library/Developer/Xcode/DerivedData'),
            os.path.join(self.home, 'Library/Developer/Xcode/Archives'),
            os.path.join(self.home, 'Library/Developer/CoreSimulator'),
        ]

        # Nettoyer d'abord les dossiers utilisateur
        for directory in user_cache_dirs:
            if os.path.exists(directory):
                size = self.clean_directory(directory)
                if size > 0:
                    print(f"Nettoyé {self.get_size_format(size)} de {directory}")

        # Nettoyer les caches système si on est root
        if self.is_root:
            system_cache_dirs = [
                '/Library/Caches',
                '/var/log',
            ]
            for directory in system_cache_dirs:
                if os.path.exists(directory):
                    size = self.clean_directory(directory)
                    if size > 0:
                        print(f"Nettoyé {self.get_size_format(size)} de {directory}")

        # Nettoyer les fichiers temporaires
        temp_dirs = [
            os.path.join(self.home, 'Downloads'),
            '/private/tmp',
            os.path.join(self.home, '.Trash')
        ]

        for directory in temp_dirs:
            if os.path.exists(directory):
                size = self.clean_directory(directory)
                if size > 0:
                    print(f"Nettoyé {self.get_size_format(size)} de {directory}")

        # Nettoyer les caches de Homebrew en tant qu'utilisateur normal
        try:
            print("Nettoyage des caches Homebrew...")
            self.run_as_user(['brew', 'cleanup', '--prune=all'])
        except Exception as e:
            logging.error(f"Erreur lors du nettoyage de Homebrew: {str(e)}")

        # Nettoyer les caches Docker en tant qu'utilisateur normal
        try:
            print("Nettoyage des caches Docker...")
            self.run_as_user(['docker', 'system', 'prune', '-af'])
        except Exception as e:
            logging.error(f"Erreur lors du nettoyage de Docker: {str(e)}")

        # Purger les caches système si on est root
        if self.is_root:
            try:
                print("Purge des caches système...")
                subprocess.run(['purge'], check=True)
            except Exception as e:
                logging.error(f"Erreur lors de la purge du cache système: {str(e)}")

        print(f"\nTotal nettoyé: {self.get_size_format(self.total_cleaned)}")
        print(f"Log détaillé disponible dans: {self.log_file}")
        logging.info(f"Total nettoyé: {self.get_size_format(self.total_cleaned)}")
        logging.info("=== Fin du nettoyage système ===")

if __name__ == "__main__":
    cleaner = MacCleaner()
    try:
        cleaner.clean_system()
    except KeyboardInterrupt:
        print("\nNettoyage interrompu par l'utilisateur.")
    except Exception as e:
        print(f"\nErreur lors du nettoyage: {str(e)}")
        logging.error(f"Erreur lors du nettoyage: {str(e)}")
    finally:
        print("\nUtilisez 'sudo' pour nettoyer également les fichiers système.")
        print("Exemple: sudo python3 mac_cleaner.py")